/**
 * Pure helpers for the S3 database backup service.
 *
 * Kept free of mongoose/S3/AWS imports so the restore + backup planning logic
 * can be unit tested without a database or network access. The managed
 * collection names are injected by the caller so this module stays dependency
 * free.
 */

/** Backup ids are generated as `backup_<iso timestamp with : and . replaced>`. */
export const BACKUP_ID_PATTERN = /^backup_[A-Za-z0-9T._-]+$/;

export const RESTORE_BATCH_SIZE = 100;

/** S3 rejects a multi-object delete request that carries more keys than this. */
export const BACKUP_DELETE_BATCH_SIZE = 1000;

export function isValidBackupId(id: unknown): id is string {
  return typeof id === "string" && BACKUP_ID_PATTERN.test(id);
}

export interface RestoreCollectionPlan {
  name: string;
  /** Documents to insert after the collection has been cleared (empty = clear only). */
  docs: any[];
  /** True when the collection is present in the backup payload. */
  presentInBackup: boolean;
}

/**
 * Build the per-collection restore plan.
 *
 * Every managed collection is included, even when the backup predates it or
 * failed to capture it. The previous implementation only touched collections
 * that were present in the payload, so restoring an older backup silently left
 * every document of the newer collections in place even though the UI promises
 * "This will replace ALL current data with the data from this backup".
 */
export function planRestore(
  backupData: unknown,
  collectionNames: readonly string[]
): RestoreCollectionPlan[] {
  const data: Record<string, unknown> =
    backupData && typeof backupData === "object" && !Array.isArray(backupData)
      ? (backupData as Record<string, unknown>)
      : {};

  return collectionNames.map((name) => {
    const value = data[name];
    const presentInBackup = Array.isArray(value);
    return {
      name,
      docs: presentInBackup ? (value as any[]) : [],
      presentInBackup,
    };
  });
}

/** Split documents into fixed size batches for insertMany. */
export function chunkDocuments<T>(docs: T[], batchSize: number = RESTORE_BATCH_SIZE): T[][] {
  if (!Array.isArray(docs) || docs.length === 0) return [];
  const size = Number.isFinite(batchSize) && batchSize > 0 ? Math.floor(batchSize) : RESTORE_BATCH_SIZE;
  const batches: T[][] = [];
  for (let i = 0; i < docs.length; i += size) {
    batches.push(docs.slice(i, i + size));
  }
  return batches;
}

export interface BackupReadResult {
  collectionCounts: Record<string, number>;
  backupData: Record<string, any[]>;
  errors: Record<string, string>;
  status: "completed" | "failed";
}

/**
 * Fold the per-collection read outcomes of `createBackup` into a result.
 * A collection that could not be read is reported as a failure instead of being
 * silently recorded as an empty (and therefore restorable-as-empty) collection.
 */
export function summarizeBackupReads(
  collectionCounts: Record<string, number>,
  backupData: Record<string, any[]>,
  errors: Record<string, string>
): BackupReadResult {
  const failedCollections = Object.keys(errors);
  return {
    collectionCounts,
    backupData,
    errors,
    status: failedCollections.length > 0 ? "failed" : "completed",
  };
}

export function formatBackupErrors(errors: Record<string, string>): string {
  return Object.entries(errors)
    .map(([name, message]) => `${name}: ${message}`)
    .join("; ");
}

export interface BackupRestoreAssessment {
  /** When false, restore must not delete or insert any collection. */
  allowed: boolean;
  /** Human-readable reason when restore is refused. */
  reason?: string;
}

/**
 * Decide whether a stored backup may replace live collections.
 *
 * `createBackup` records a collection it could not read as an empty array and
 * sets metadata status to `failed`. Restoring that payload deletes the live
 * collection and inserts nothing. Only a completed backup is safe to apply.
 * Missing metadata is not treated as a failure (older objects may have no
 * metadata file); a backup explicitly marked failed is never restorable.
 */
export function assessBackupRestore(
  metadata: { status?: string | null; error?: string | null } | null | undefined
): BackupRestoreAssessment {
  if (metadata?.status === "failed") {
    const detail = typeof metadata.error === "string" ? metadata.error.trim() : "";
    return {
      allowed: false,
      reason: detail.length > 0 ? detail : "Backup is incomplete and cannot be restored",
    };
  }
  return { allowed: true };
}

/** One `Errors` entry of a `DeleteObjectsCommand` response. */
export interface BackupDeleteResponseError {
  Key?: string | undefined;
  Code?: string | undefined;
  Message?: string | undefined;
}

/** The part of a `DeleteObjectsCommand` response that reports per-key failures. */
export interface BackupDeleteResponse {
  Errors?: ReadonlyArray<BackupDeleteResponseError> | undefined;
}

/** A key S3 refused to remove, with the reason it gave. */
export interface BackupDeleteObjectError {
  /** Key that is still stored. */
  key: string;
  /** S3 per-key error code, for example `AccessDenied` or `InternalError`. */
  code: string;
  message: string;
  /** True when retrying the deletion can succeed (throttling, S3 internal errors). */
  retryable: boolean;
}

export interface BackupDeleteOutcome {
  /** True only when every requested key is gone from the bucket. */
  success: boolean;
  /** Number of keys S3 removed. */
  deletedObjects: number;
  /** Number of keys that are still stored. */
  failedObjects: number;
  /** Keys that are still stored, in request order. */
  failedKeys: string[];
  /** Per-key failures behind `failedKeys`. */
  errors: BackupDeleteObjectError[];
  /** Administrator facing summary of what remains stored. */
  message: string;
}

const RETRYABLE_DELETE_ERROR_CODES = new Set([
  "InternalError",
  "RequestTimeTooSkewed",
  "RequestTimeout",
  "ServiceUnavailable",
  "SlowDown",
  "Throttling",
  "ThrottlingException",
]);

const RETRYABLE_DELETE_ERROR_PATTERN =
  /InternalError|Timeout|SlowDown|Throttl|Unavailable|TryAgain|Connection/i;

/**
 * Separate transient per-key failures from permanent ones.
 *
 * A retryable error (`InternalError`, `SlowDown`, timeouts) may succeed when
 * the delete is repeated; `AccessDenied` or a bucket policy failure will not.
 */
export function isRetryableBackupDeleteError(
  error: BackupDeleteResponseError | null | undefined
): boolean {
  const code = typeof error?.Code === "string" ? error.Code.trim() : "";
  if (code.length === 0) return false;
  return RETRYABLE_DELETE_ERROR_CODES.has(code) || RETRYABLE_DELETE_ERROR_PATTERN.test(code);
}

function normalizeDeleteKeys(
  keys: ReadonlyArray<string | null | undefined> | null | undefined
): string[] {
  const seen = new Set<string>();
  for (const key of keys ?? []) {
    if (typeof key === "string" && key.length > 0) seen.add(key);
  }
  return [...seen];
}

/**
 * Fold every `DeleteObjectsCommand` response into the outcome the admin sees.
 *
 * S3 accepts a multi-object delete request as a whole and reports the keys it
 * could not remove in `Errors`, so a returned response is not proof that the
 * objects are gone. `Quiet: true` only suppresses the successful-key entries;
 * the failures are still returned. A key that no response complained about is
 * counted as deleted, everything else is reported with its error so the
 * administrator can retry the keys that remain.
 *
 * Exceptions thrown by the delete request itself are not handled here: they
 * describe a request that never ran and are meant to reach the caller.
 */
export function summarizeBackupDeletes(
  requestedKeys: ReadonlyArray<string | null | undefined> | null | undefined,
  responses: ReadonlyArray<BackupDeleteResponse | null | undefined> | null | undefined
): BackupDeleteOutcome {
  const requested = normalizeDeleteKeys(requestedKeys);
  const failures = new Map<string, BackupDeleteObjectError>();

  for (const response of responses ?? []) {
    for (const error of response?.Errors ?? []) {
      const key = typeof error?.Key === "string" ? error.Key.trim() : "";
      if (key.length === 0 || failures.has(key)) continue;
      const code =
        typeof error.Code === "string" && error.Code.trim().length > 0
          ? error.Code.trim()
          : "UnknownError";
      const message =
        typeof error.Message === "string" && error.Message.trim().length > 0
          ? error.Message.trim()
          : `S3 reported no reason for failing to delete ${key}`;
      failures.set(key, { key, code, message, retryable: isRetryableBackupDeleteError(error) });
    }
  }

  const failedKeys = requested.filter((key) => failures.has(key));
  const errors = failedKeys.map((key) => failures.get(key) as BackupDeleteObjectError);
  const deletedObjects = requested.length - failedKeys.length;

  if (failedKeys.length === 0) {
    return {
      success: true,
      deletedObjects,
      failedObjects: 0,
      failedKeys,
      errors,
      message: `Deleted ${deletedObjects} of ${requested.length} objects`,
    };
  }

  const details = errors.map((error) => `${error.key} (${error.code})`).join("; ");
  const transient = errors.filter((error) => error.retryable).length;
  const transientHint =
    transient > 0
      ? ` ${transient} of ${errors.length} failures are transient (${
          errors.filter((error) => error.retryable).map((error) => error.code).join(", ")
        }) and may succeed on retry.`
      : "";

  return {
    success: false,
    deletedObjects,
    failedObjects: failedKeys.length,
    failedKeys,
    errors,
    message: `Deleted ${deletedObjects} of ${requested.length} objects, ${failedKeys.length} could not be deleted: ${details}.${transientHint} The backup is still stored and the deletion can be retried.`,
  };
}
