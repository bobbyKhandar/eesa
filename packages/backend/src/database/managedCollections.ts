/**
 * Managed collection registry
 *
 * Single source of truth for the collections that are counted by the admin
 * dashboard, backed up to S3, restored from S3 and cleared by
 * `POST /api/admin/database/truncate`.
 *
 * Keeping the list in one place prevents the previous drift where the new
 * feature `Subject` collection was counted and backed up but never truncated
 * (truncate reported success while leaving every subject document behind).
 *
 * This module must stay dependency free (no mongoose/zod imports) so it can be
 * unit tested in isolation.
 */

export const MANAGED_COLLECTION_NAMES = [
  'questions',
  'examSets',
  'user',
  'ExamSubmission',
  'Prompt',
  'ExamQuestion',
  'subjects',
  'JobMetadata',
  'UploadSession',
  'AnalysisReport',
  'ExamAnalysis',
  'PastPaper',
  'Syllabus',
  'UniqueQuestion',
  'Subject',
] as const;

export type ManagedCollectionName = (typeof MANAGED_COLLECTION_NAMES)[number];

const MANAGED_COLLECTION_NAME_SET: ReadonlySet<string> = new Set<string>(
  MANAGED_COLLECTION_NAMES
);

export function isManagedCollectionName(value: unknown): value is ManagedCollectionName {
  return typeof value === 'string' && MANAGED_COLLECTION_NAME_SET.has(value);
}

export interface TruncationResult {
  before: number;
  deleted: number;
  error?: string;
}

export interface TruncationSummary {
  totalDeleted: number;
  totalBefore: number;
  hasErrors: boolean;
}

/**
 * Aggregate the per-collection truncation results into a single summary.
 * `results` is keyed by collection name and may contain partial failures.
 */
export function summarizeTruncation(
  results: Record<string, TruncationResult>
): TruncationSummary {
  let totalDeleted = 0;
  let totalBefore = 0;
  let hasErrors = false;

  for (const result of Object.values(results)) {
    totalDeleted += result.deleted || 0;
    totalBefore += result.before || 0;
    if (result.error) hasErrors = true;
  }

  return { totalDeleted, totalBefore, hasErrors };
}

/**
 * Collections that still hold documents after a truncation run.
 * Used by tests/logs to detect partial truncations.
 */
export function listCollectionsWithLeftovers(
  results: Record<string, TruncationResult>
): string[] {
  return Object.entries(results)
    .filter(([, result]) => (result.before || 0) > (result.deleted || 0) || Boolean(result.error))
    .map(([name]) => name);
}
