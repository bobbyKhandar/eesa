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
