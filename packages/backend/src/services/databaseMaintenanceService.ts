import { connect } from "../database/connect";
import { getManagedCollections } from "../database/managedCollectionModels";
import type { ManagedCollection } from "../database/managedCollectionModels";

/**
 * Admin database maintenance operations.
 *
 * The database is MongoDB, so the SQL-style maintenance controls that used to
 * sit on the admin page (OPTIMIZE TABLE, REBUILD INDEXES, ...) have no
 * equivalent here and must stay disabled in the UI. The only maintenance this
 * module offers is read-only diagnostics over the managed collection registry:
 * nothing in this file writes, deletes, drops, compacts, or re-indexes.
 */

export const MAINTENANCE_ACTIONS = [
  "check-integrity",
  "validate-constraints",
] as const;

export type MaintenanceAction = (typeof MAINTENANCE_ACTIONS)[number];

/** Thrown when the caller requests an operation outside the allowlist. */
export class InvalidMaintenanceActionError extends Error {
  constructor(action: unknown) {
    super(`Unsupported maintenance action: ${String(action)}`);
    this.name = "InvalidMaintenanceActionError";
  }
}

export function isMaintenanceAction(value: unknown): value is MaintenanceAction {
  return (
    typeof value === "string" &&
    (MAINTENANCE_ACTIONS as readonly string[]).includes(value)
  );
}

export const DEFAULT_VALIDATION_SAMPLE_SIZE = 10;
export const MAX_VALIDATION_SAMPLE_SIZE = 25;

/**
 * Clamp the per-collection validation sample to a small bounded window so a
 * constraint check cannot turn into a full collection scan.
 */
export function normalizeValidationSampleSize(value: unknown): number {
  const parsed = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isInteger(parsed)) {
    return DEFAULT_VALIDATION_SAMPLE_SIZE;
  }
  if (parsed < 1) return DEFAULT_VALIDATION_SAMPLE_SIZE;
  return Math.min(parsed, MAX_VALIDATION_SAMPLE_SIZE);
}

export interface IntegrityCollectionResult {
  name: string;
  documents: number;
  indexes: number;
  ok: boolean;
  error?: string;
}

export interface IntegrityResult {
  action: "check-integrity";
  collections: IntegrityCollectionResult[];
  totalDocuments: number;
  collectionsChecked: number;
  collectionsWithIssues: number;
}

export interface ConstraintCollectionResult {
  name: string;
  checked: number;
  valid: number;
  invalid: number;
  ok: boolean;
  error?: string;
  sampleErrors?: string[];
}

export interface ConstraintValidationResult {
  action: "validate-constraints";
  sampleSize: number;
  collections: ConstraintCollectionResult[];
  totalChecked: number;
  totalInvalid: number;
  collectionsWithIssues: number;
}

export type MaintenanceResult = IntegrityResult | ConstraintValidationResult;

type CollectionLike = Pick<ManagedCollection, "name"> & {
  model: {
    countDocuments: (filter: Record<string, never>) => Promise<number>;
    find: (filter: Record<string, never>) => {
      limit: (n: number) => { lean: () => Promise<unknown[]> };
    };
    collection: { indexes: () => Promise<unknown[]> };
    new (doc: unknown): { validate: () => Promise<void> };
  };
};

function toCollectionLike(collection: ManagedCollection): CollectionLike {
  return collection as unknown as CollectionLike;
}

/**
 * Read-only integrity snapshot: per-collection document counts plus the
 * number of indexes MongoDB currently maintains on each collection. A
 * collection that cannot be counted or inspected is reported with ok: false
 * instead of aborting the whole run.
 */
export async function checkIntegrity(
  collections?: ManagedCollection[]
): Promise<IntegrityResult> {
  // Tests inject fake collections; only open a real connection for live runs
  // against the managed registry.
  const targets = collections ?? getManagedCollections();
  if (collections === undefined) {
    await connect();
  }

  const results: IntegrityCollectionResult[] = [];
  for (const collection of targets.map(toCollectionLike)) {
    try {
      const [documents, indexes] = await Promise.all([
        collection.model.countDocuments({}),
        collection.model.collection.indexes(),
      ]);
      results.push({
        name: collection.name,
        documents,
        indexes: Array.isArray(indexes) ? indexes.length : 0,
        ok: true,
      });
    } catch (error) {
      results.push({
        name: collection.name,
        documents: 0,
        indexes: 0,
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return {
    action: "check-integrity",
    collections: results,
    totalDocuments: results.reduce((sum, entry) => sum + entry.documents, 0),
    collectionsChecked: results.length,
    collectionsWithIssues: results.filter((entry) => !entry.ok).length,
  };
}

const MAX_SAMPLE_ERRORS_PER_COLLECTION = 3;

/**
 * Read-only constraint check: re-validates a bounded sample of documents from
 * each managed collection against its Mongoose schema in memory. Documents are
 * only read, never modified; validation failures are counted and summarized.
 */
export async function validateConstraints(
  sampleSize: unknown = DEFAULT_VALIDATION_SAMPLE_SIZE,
  collections?: ManagedCollection[]
): Promise<ConstraintValidationResult> {
  const size = normalizeValidationSampleSize(sampleSize);
  // Tests inject fake collections; only open a real connection for live runs
  // against the managed registry.
  const targets = collections ?? getManagedCollections();
  if (collections === undefined) {
    await connect();
  }

  const results: ConstraintCollectionResult[] = [];
  for (const collection of targets.map(toCollectionLike)) {
    try {
      const docs = await collection.model.find({}).limit(size).lean();
      const sample = Array.isArray(docs) ? docs : [];
      let invalid = 0;
      const sampleErrors: string[] = [];
      for (let index = 0; index < sample.length; index += 1) {
        try {
          await new collection.model(sample[index]).validate();
        } catch (error) {
          invalid += 1;
          if (sampleErrors.length < MAX_SAMPLE_ERRORS_PER_COLLECTION) {
            sampleErrors.push(
              `Document ${index}: ${error instanceof Error ? error.message : "Unknown error"}`
            );
          }
        }
      }
      results.push({
        name: collection.name,
        checked: sample.length,
        valid: sample.length - invalid,
        invalid,
        ok: invalid === 0,
        ...(sampleErrors.length > 0 ? { sampleErrors } : {}),
      });
    } catch (error) {
      results.push({
        name: collection.name,
        checked: 0,
        valid: 0,
        invalid: 0,
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return {
    action: "validate-constraints",
    sampleSize: size,
    collections: results,
    totalChecked: results.reduce((sum, entry) => sum + entry.checked, 0),
    totalInvalid: results.reduce((sum, entry) => sum + entry.invalid, 0),
    collectionsWithIssues: results.filter((entry) => !entry.ok).length,
  };
}

/**
 * Dispatch an allowlisted maintenance action. Anything outside the allowlist
 * throws before any database work happens.
 */
export async function runMaintenanceAction(
  action: unknown,
  options: { sampleSize?: unknown; collections?: ManagedCollection[] } = {}
): Promise<MaintenanceResult> {
  if (!isMaintenanceAction(action)) {
    throw new InvalidMaintenanceActionError(action);
  }
  if (action === "check-integrity") {
    return checkIntegrity(options.collections);
  }
  return validateConstraints(options.sampleSize, options.collections);
}
