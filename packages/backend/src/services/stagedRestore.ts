import { randomBytes } from "node:crypto";

import { formatBackupErrors, type RestoreCollectionPlan } from "./backupPlan";

/**
 * Publish a backup by writing every collection into a side collection, then
 * renaming those collections into place.
 *
 * Validating the payload and then deleting live data still loses documents
 * when a later insert fails. An in-memory snapshot has the same hole: the
 * rollback write can fail the same way, and a crash between the delete and
 * the rollback leaves the collection empty. Multi-document transactions are
 * not available on a standalone server and can expire mid-restore on Atlas.
 *
 * Staging never clears a live collection until every collection has been
 * written. A failed insert drops the side collections. A failed rename puts
 * already published collections back. The pre-swap copy is dropped only after
 * every collection has been published.
 */

const RESERVED_PREFIXES = ["eesa_rstg_", "eesa_rprv_", "eesa_rasd_"] as const;

const INDEX_OPTION_FIELDS = [
  "unique",
  "sparse",
  "expireAfterSeconds",
  "partialFilterExpression",
  "collation",
  "weights",
  "default_language",
  "language_override",
  "hidden",
  "wildcardProjection",
  "textIndexVersion",
] as const;

export interface RestoreCollectionBinding {
  name: string;
  /** MongoDB collection name, which can differ from the registry key. */
  physicalName: string;
  validate(docs: unknown[]): Promise<void>;
  /**
   * Insert every document into the staging collection. Throw unless every
   * document was written; a partial insert must not be treated as success.
   */
  insertInto(stagingCollection: string, docs: unknown[]): Promise<number>;
}

export interface RestoreCollectionDriver {
  indexes(): Promise<Array<Record<string, unknown>>>;
  createIndex(keys: Record<string, unknown>, options: Record<string, unknown>): Promise<unknown>;
  rename(newName: string, options?: { dropTarget?: boolean }): Promise<unknown>;
  drop(): Promise<unknown>;
}

export interface RestoreDatabase {
  listCollections(filter: { name: string }): { toArray(): Promise<Array<{ name: string }>> };
  createCollection(name: string): Promise<unknown>;
  collection(name: string): RestoreCollectionDriver;
}

export interface StagedRestoreOps {
  validate(name: string, docs: unknown[]): Promise<void>;
  stage(name: string, docs: unknown[]): Promise<number>;
  swap(name: string): Promise<void>;
  unswap(name: string): Promise<void>;
  discard(name: string): Promise<void>;
  dropPrevious(name: string): Promise<void>;
}

export interface StagedRestoreOutcome {
  applied: boolean;
  /** When the restore did not apply, true means every live collection still has its previous documents. */
  liveDataPreserved: boolean;
  collectionCounts: Record<string, number>;
  errors: Record<string, string>;
  warnings: string[];
}

type RestorePhase = "creating" | "staged" | "live-absent" | "live-moved" | "swapped" | "aside" | "unstaged";

export function createRestoreToken(): string {
  return randomBytes(4).toString("hex");
}

export function stagingCollectionName(token: string, physicalName: string): string {
  return sideCollectionName("eesa_rstg_", token, physicalName);
}

export function previousCollectionName(token: string, physicalName: string): string {
  return sideCollectionName("eesa_rprv_", token, physicalName);
}

export function asideCollectionName(token: string, physicalName: string): string {
  return sideCollectionName("eesa_rasd_", token, physicalName);
}

export function createStagedRestoreOps(
  db: RestoreDatabase,
  bindings: readonly RestoreCollectionBinding[],
  token: string
): StagedRestoreOps {
  if (!/^[a-f0-9]{8}$/.test(token)) {
    throw new Error("Invalid restore token");
  }

  const byName = new Map<string, RestoreCollectionBinding>();
  const physicalNames = new Set<string>();
  for (const binding of bindings) {
    assertSafePhysicalName(binding.physicalName);
    if (byName.has(binding.name) || physicalNames.has(binding.physicalName)) {
      throw new Error(`Duplicate restore collection: ${binding.name}`);
    }
    byName.set(binding.name, binding);
    physicalNames.add(binding.physicalName);
  }

  const phases = new Map<string, RestorePhase>();

  function requireBinding(name: string): RestoreCollectionBinding {
    const binding = byName.get(name);
    if (!binding) throw new Error(`No restore binding for collection ${name}`);
    return binding;
  }

  return {
    async validate(name, docs) {
      await requireBinding(name).validate(docs);
    },

    async stage(name, docs) {
      const binding = requireBinding(name);
      const stagingName = stagingCollectionName(token, binding.physicalName);
      phases.set(name, "creating");
      await dropIfExists(db, stagingName);
      await db.createCollection(stagingName);
      await copyIndexes(db, binding.physicalName, stagingName);
      const inserted = docs.length === 0 ? 0 : await binding.insertInto(stagingName, docs);
      if (inserted !== docs.length) {
        throw new Error(`Staged ${inserted} of ${docs.length} documents`);
      }
      phases.set(name, "staged");
      return inserted;
    },

    async swap(name) {
      const binding = requireBinding(name);
      const physicalName = binding.physicalName;
      const stagingName = stagingCollectionName(token, physicalName);
      const previousName = previousCollectionName(token, physicalName);
      if (await collectionExists(db, previousName)) {
        throw new Error(`Previous restore copy ${previousName} already exists`);
      }
      if (await collectionExists(db, physicalName)) {
        await db.collection(physicalName).rename(previousName, { dropTarget: false });
        phases.set(name, "live-moved");
      } else {
        phases.set(name, "live-absent");
      }
      await db.collection(stagingName).rename(physicalName, { dropTarget: false });
      phases.set(name, "swapped");
    },

    async unswap(name) {
      const binding = requireBinding(name);
      const physicalName = binding.physicalName;
      const previousName = previousCollectionName(token, physicalName);
      const asideName = asideCollectionName(token, physicalName);
      const phase = phases.get(name);

      if (phase === "live-moved") {
        try {
          await db.collection(previousName).rename(physicalName, { dropTarget: false });
          phases.set(name, "staged");
        } catch (error) {
          throw new Error(
            `Failed to roll back ${physicalName}: ${errorMessage(error)}. Previous documents remain in ${previousName}`
          );
        }
        return;
      }

      if (phase === "swapped") {
        try {
          await db.collection(physicalName).rename(asideName, { dropTarget: false });
          phases.set(name, "aside");
          if (await collectionExists(db, previousName)) {
            await db.collection(previousName).rename(physicalName, { dropTarget: false });
          }
          phases.set(name, "unstaged");
        } catch (error) {
          throw new Error(
            `Failed to roll back ${physicalName}: ${errorMessage(error)}. Previous documents remain in ${previousName}`
          );
        }
      }
    },

    async discard(name) {
      const binding = requireBinding(name);
      // Only side collections. The live name and the pre-swap copy stay put
      // so a failed rollback can still be recovered by hand.
      await dropIfExists(db, stagingCollectionName(token, binding.physicalName));
      await dropIfExists(db, asideCollectionName(token, binding.physicalName));
    },

    async dropPrevious(name) {
      const binding = requireBinding(name);
      await dropIfExists(db, previousCollectionName(token, binding.physicalName));
    },
  };
}

export async function applyStagedRestore(
  plan: readonly RestoreCollectionPlan[],
  ops: StagedRestoreOps
): Promise<StagedRestoreOutcome> {
  const errors: Record<string, string> = {};
  const collectionCounts: Record<string, number> = {};

  for (const entry of plan) {
    try {
      assertPlainDocuments(entry.name, entry.docs);
      await ops.validate(entry.name, entry.docs);
    } catch (error) {
      errors[entry.name] = `Backup payload is not restorable: ${errorMessage(error)}`;
    }
  }
  if (Object.keys(errors).length > 0) {
    return preservedFailure(errors);
  }

  const staged: string[] = [];
  for (const entry of plan) {
    try {
      collectionCounts[entry.name] = await ops.stage(entry.name, entry.docs);
      staged.push(entry.name);
    } catch (error) {
      errors[entry.name] = `Failed to stage documents: ${errorMessage(error)}`;
      staged.push(entry.name);
      break;
    }
  }
  if (Object.keys(errors).length > 0) {
    const preserved = await discardStaged(ops, staged, errors);
    return {
      applied: false,
      liveDataPreserved: preserved,
      collectionCounts: {},
      errors,
      warnings: [],
    };
  }

  const swapped: string[] = [];
  let publishFailure: string | null = null;
  for (const entry of plan) {
    try {
      await ops.swap(entry.name);
      swapped.push(entry.name);
    } catch (error) {
      errors[entry.name] = `Failed to publish staged collection: ${errorMessage(error)}`;
      publishFailure = entry.name;
      break;
    }
  }
  if (publishFailure) {
    const preserved = await rollBackPublished(ops, [...swapped, publishFailure], errors);
    const discarded = await discardStaged(ops, staged, errors);
    return {
      applied: false,
      liveDataPreserved: preserved && discarded,
      collectionCounts: {},
      errors,
      warnings: [],
    };
  }

  const warnings: string[] = [];
  for (const entry of plan) {
    try {
      await ops.dropPrevious(entry.name);
    } catch (error) {
      warnings.push(`${entry.name}: ${errorMessage(error)}`);
    }
  }

  return {
    applied: true,
    liveDataPreserved: false,
    collectionCounts,
    errors: {},
    warnings,
  };
}

export function toRestoreResult(outcome: StagedRestoreOutcome): {
  success: boolean;
  message: string;
  collectionCounts: Record<string, number>;
  errors: Record<string, string>;
} {
  if (!outcome.applied) {
    const detail = formatBackupErrors(outcome.errors);
    const summary = outcome.liveDataPreserved
      ? "Restore failed; live data was left unchanged"
      : "Restore failed and live data could not be fully rolled back";
    return {
      success: false,
      message: detail ? `${summary}. ${detail}` : summary,
      collectionCounts: {},
      errors: outcome.errors,
    };
  }

  const total = Object.values(outcome.collectionCounts).reduce((sum, count) => sum + count, 0);
  const collections = Object.keys(outcome.collectionCounts).length;
  let message = `Restored ${total} documents across ${collections} collections`;
  if (outcome.warnings.length > 0) {
    message += `. Leftover pre-restore copies could not be deleted: ${outcome.warnings.join("; ")}`;
  }
  return {
    success: true,
    message,
    collectionCounts: outcome.collectionCounts,
    errors: {},
  };
}

function preservedFailure(errors: Record<string, string>): StagedRestoreOutcome {
  return {
    applied: false,
    liveDataPreserved: true,
    collectionCounts: {},
    errors,
    warnings: [],
  };
}

async function rollBackPublished(
  ops: StagedRestoreOps,
  names: readonly string[],
  errors: Record<string, string>
): Promise<boolean> {
  let preserved = true;
  for (const name of [...names].reverse()) {
    try {
      await ops.unswap(name);
    } catch (error) {
      preserved = false;
      const failure = errorMessage(error);
      errors[name] = errors[name] ? `${errors[name]}; ${failure}` : failure;
    }
  }
  return preserved;
}

async function discardStaged(
  ops: StagedRestoreOps,
  names: readonly string[],
  errors: Record<string, string>
): Promise<boolean> {
  let preserved = true;
  for (const name of names) {
    try {
      await ops.discard(name);
    } catch (error) {
      preserved = false;
      const failure = `Failed to discard staged documents: ${errorMessage(error)}`;
      errors[name] = errors[name] ? `${errors[name]}; ${failure}` : failure;
    }
  }
  return preserved;
}

function assertPlainDocuments(name: string, docs: unknown[]): void {
  if (!Array.isArray(docs)) {
    throw new Error(`${name} backup payload is not an array`);
  }
  for (let index = 0; index < docs.length; index += 1) {
    const doc = docs[index];
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
      throw new Error(`${name} document ${index} is not an object`);
    }
  }
}

function sideCollectionName(prefix: string, token: string, physicalName: string): string {
  assertSafePhysicalName(physicalName);
  if (!/^[a-f0-9]{8}$/.test(token)) {
    throw new Error("Invalid restore token");
  }
  return `${prefix}${token}_${physicalName}`;
}

function assertSafePhysicalName(physicalName: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(physicalName)) {
    throw new Error(`Unsafe collection name: ${physicalName}`);
  }
  if (RESERVED_PREFIXES.some((prefix) => physicalName.startsWith(prefix))) {
    throw new Error(`Refusing to restore reserved collection: ${physicalName}`);
  }
}

async function collectionExists(db: RestoreDatabase, name: string): Promise<boolean> {
  const rows = await db.listCollections({ name }).toArray();
  return rows.some((row) => row.name === name);
}

async function dropIfExists(db: RestoreDatabase, name: string): Promise<void> {
  try {
    await db.collection(name).drop();
  } catch (error) {
    if (isNamespaceNotFound(error)) return;
    throw error;
  }
}

async function copyIndexes(
  db: RestoreDatabase,
  sourceName: string,
  targetName: string
): Promise<void> {
  let specs: Array<Record<string, unknown>>;
  try {
    specs = await db.collection(sourceName).indexes();
  } catch (error) {
    if (isNamespaceNotFound(error)) return;
    throw error;
  }

  for (const spec of specs) {
    const key = spec?.key;
    if (!key || typeof key !== "object" || Array.isArray(key) || spec.name === "_id_") continue;
    const options: Record<string, unknown> = {};
    if (typeof spec.name === "string" && spec.name.length > 0) options.name = spec.name;
    for (const field of INDEX_OPTION_FIELDS) {
      if (spec[field] !== undefined) options[field] = spec[field];
    }
    await db.collection(targetName).createIndex(key as Record<string, unknown>, options);
  }
}

function isNamespaceNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  const codeName = (error as { codeName?: unknown }).codeName;
  return code === 26 || codeName === "NamespaceNotFound";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
