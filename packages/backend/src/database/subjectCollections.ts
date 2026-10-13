/**
 * Legacy question-bank subjects and the academic subject catalog are different
 * documents. Mongoose pluralizes both model names ("subjects" and "Subject")
 * onto the collection "subjects", so backup, restore and truncate used to
 * operate on that collection twice. These names are the physical collections.
 */

export const LEGACY_SUBJECT_COLLECTION = "subjects";
export const FEATURE_SUBJECT_COLLECTION = "featureSubjects";

const FEATURE_SUBJECT_CODE = /^[A-Z]{2}\d{3}$/;

export interface SubjectSeparationPlan {
  move: Record<string, unknown>[];
  keep: Record<string, unknown>[];
}

export interface SubjectSeparationResult {
  moved: number;
  kept: number;
  alreadyPresent: number;
  failed: Array<{ id: string; error: string }>;
}

export interface SubjectDocumentStore {
  findAll(): Promise<Record<string, unknown>[]>;
  findById(id: unknown): Promise<Record<string, unknown> | null>;
  insert(doc: Record<string, unknown>): Promise<void>;
  deleteById(id: unknown): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Question-bank subjects are identified by `subjectName`. A document that also
 * carries catalog fields stays here so publish links (`analysisReportIds`)
 * are not moved onto the catalog collection.
 */
export function isLegacySubjectDocument(doc: unknown): boolean {
  return isRecord(doc) && nonEmptyString(doc.subjectName);
}

/**
 * Catalog subjects are the feature schema: a name plus a code in XX### form,
 * and none of the question-bank markers.
 */
export function isFeatureSubjectDocument(doc: unknown): doc is Record<string, unknown> {
  if (!isRecord(doc) || isLegacySubjectDocument(doc)) return false;
  if (Array.isArray(doc.analysisReportIds) && doc.analysisReportIds.length > 0) return false;
  return nonEmptyString(doc.name) && typeof doc.code === "string" && FEATURE_SUBJECT_CODE.test(doc.code);
}

export function planSubjectSeparation(docs: readonly unknown[]): SubjectSeparationPlan {
  const move: Record<string, unknown>[] = [];
  const keep: Record<string, unknown>[] = [];
  for (const doc of docs) {
    if (isFeatureSubjectDocument(doc)) move.push(doc);
    else if (isRecord(doc)) keep.push(doc);
  }
  return { move, keep };
}

function documentId(doc: Record<string, unknown>): string {
  if (doc._id === undefined || doc._id === null) return "";
  return String(doc._id);
}

/**
 * Copy catalog documents out of the legacy collection, then delete the source
 * only after the destination holds the same `_id`. Safe to run again: a copy
 * that already exists is left untouched and the source row is removed.
 */
export async function separateMixedSubjectDocuments(
  legacy: SubjectDocumentStore,
  feature: SubjectDocumentStore
): Promise<SubjectSeparationResult> {
  const docs = await legacy.findAll();
  const plan = planSubjectSeparation(docs);
  const result: SubjectSeparationResult = {
    moved: 0,
    kept: plan.keep.length,
    alreadyPresent: 0,
    failed: [],
  };

  for (const doc of plan.move) {
    const id = documentId(doc);
    if (!id || doc._id === undefined || doc._id === null) {
      result.failed.push({ id, error: "missing _id" });
      continue;
    }

    try {
      const existing = await feature.findById(doc._id);
      if (!existing) {
        await feature.insert(doc);
      }
      const copied = await feature.findById(doc._id);
      if (!copied) {
        result.failed.push({ id, error: "feature copy missing after insert" });
        continue;
      }
      await legacy.deleteById(doc._id);
      if (existing) result.alreadyPresent += 1;
      else result.moved += 1;
    } catch (error) {
      result.failed.push({
        id,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return result;
}
