import { questionIdOf } from "../services/mcqAlignment.js";

/**
 * `$lookup` + `$in` does not preserve the parent array's order. Callers that
 * render or grade `questionDetails` need the sequence stored on the exam.
 *
 * Ids on the exam come first, in that sequence. An id the join did not return
 * is skipped. Joined rows that are not on the exam stay afterwards, in the
 * order the join produced, so a question is never dropped just to fix order.
 */
export function orderQuestionDetails<T>(
  authoredIds: readonly unknown[] | null | undefined,
  details: readonly T[] | null | undefined,
): T[] {
  const rows = Array.isArray(details) ? [...details] : [];
  if (!Array.isArray(authoredIds)) return rows;

  const buckets = new Map<string, T[]>();
  for (const row of rows) {
    const id = detailId(row);
    if (id == null) continue;
    const bucket = buckets.get(id);
    if (bucket) bucket.push(row);
    else buckets.set(id, [row]);
  }

  const ordered: T[] = [];
  const placed = new Set<T>();
  for (const authoredId of authoredIds) {
    const next = buckets.get(authoredIdKey(authoredId))?.shift();
    if (next === undefined) continue;
    ordered.push(next);
    placed.add(next);
  }
  for (const row of rows) {
    if (!placed.has(row)) ordered.push(row);
  }
  return ordered;
}

function detailId(row: unknown): string | null {
  if (row == null || typeof row !== "object") return null;
  return questionIdOf(row as { _id?: { toString(): string } | string });
}

function authoredIdKey(id: unknown): string {
  if (typeof id === "string") return id;
  if (id == null) return "";
  if (typeof id === "object") {
    const record = id as { _id?: unknown; toString?: () => string };
    if (record._id != null && record._id !== id) return authoredIdKey(record._id);
    if (typeof record.toString === "function") {
      const text = record.toString();
      if (text && text !== "[object Object]") return text;
    }
    return "";
  }
  return String(id);
}
