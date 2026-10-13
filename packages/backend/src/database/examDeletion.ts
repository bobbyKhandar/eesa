/**
 * Soft-delete helpers for exams.
 * A deletion timestamp hides an exam from listings and new attempts.
 * The exam document and its questions stay so saved submissions can still
 * join the title, prompt text, and marks.
 */

export function isExamDeleted(deletedAt: unknown): boolean {
  if (deletedAt == null || deletedAt === "") return false;
  const date =
    deletedAt instanceof Date
      ? deletedAt
      : typeof deletedAt === "string" || typeof deletedAt === "number"
        ? new Date(deletedAt)
        : null;
  if (!date) return false;
  return Number.isFinite(date.getTime());
}

/**
 * Mongo filter for exams that are still visible in listings.
 * `null` alone is not enough: this matches both a missing timestamp and an
 * explicit null, and ANDs with any other predicates the caller already has.
 */
export function activeExamQuery<T extends Record<string, unknown>>(
  filter: T = {} as T,
): T & { $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }] } {
  return {
    ...filter,
    $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }],
  };
}
