/**
 * Cursor pagination for a user's graded exam history.
 *
 * Pages are newest first and stable when two submissions share `submittedAt`.
 * The cursor is opaque. A value this module did not emit is rejected so a
 * caller cannot turn it into a collection scan.
 */

import { gradedSubmissionFilter } from "./examSubmissionClaim.js";

export const SUBMISSION_HISTORY_DEFAULT_LIMIT = 20;
export const SUBMISSION_HISTORY_MAX_LIMIT = 50;

const OBJECT_ID = /^[a-f0-9]{24}$/i;

export class InvalidResultsCursorError extends Error {
  constructor() {
    super("Invalid results cursor");
    this.name = "InvalidResultsCursorError";
  }
}

export function isInvalidResultsCursorError(error: unknown): boolean {
  return (
    error instanceof InvalidResultsCursorError ||
    (typeof error === "object" &&
      error !== null &&
      (error as { name?: unknown }).name === "InvalidResultsCursorError")
  );
}

export interface HistoryCursor {
  submittedAt: Date;
  id: string;
}

export interface SubmissionHistoryPageQuery {
  limit?: number;
  cursor?: string | null;
}

/** A missing or unusable limit falls back to the default. Above the max, clamp. */
export function clampHistoryLimit(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 1) return SUBMISSION_HISTORY_DEFAULT_LIMIT;
  return Math.min(parsed, SUBMISSION_HISTORY_MAX_LIMIT);
}

export function encodeHistoryCursor(input: HistoryCursor): string {
  const payload = JSON.stringify({
    t: input.submittedAt.toISOString(),
    id: input.id,
  });
  return Buffer.from(payload, "utf8").toString("base64url");
}

export function decodeHistoryCursor(cursor: string): HistoryCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new InvalidResultsCursorError();
  }

  if (!parsed || typeof parsed !== "object") throw new InvalidResultsCursorError();
  const record = parsed as { t?: unknown; id?: unknown };
  if (typeof record.t !== "string" || typeof record.id !== "string") {
    throw new InvalidResultsCursorError();
  }
  if (!OBJECT_ID.test(record.id)) throw new InvalidResultsCursorError();

  const submittedAt = new Date(record.t);
  if (Number.isNaN(submittedAt.getTime()) || record.t !== submittedAt.toISOString()) {
    throw new InvalidResultsCursorError();
  }

  return { submittedAt, id: record.id };
}

/**
 * Graded submissions for one user, optionally older than a cursor.
 * Pending grading claims stay excluded.
 */
export function historyPageFilter(
  userId: string,
  cursor: HistoryCursor | null,
): Record<string, unknown> {
  const filter = gradedSubmissionFilter({ userId }) as Record<string, unknown>;
  if (!cursor) return filter;

  return {
    ...filter,
    $or: [
      { submittedAt: { $lt: cursor.submittedAt } },
      { submittedAt: cursor.submittedAt, _id: { $lt: cursor.id } },
    ],
  };
}
