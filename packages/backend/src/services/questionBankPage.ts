/**
 * Cursor pagination for the resource question bank.
 *
 * Unique-question pages are ordered by occurrence count, then id, so two
 * questions with the same count do not swap places between requests. The
 * cursor is opaque. A value this module did not emit is rejected so a caller
 * cannot turn it into a collection scan.
 *
 * The fallback path (published reports, when UniqueQuestions has no rows)
 * pages distinct prompt ids and summarizes the whole subject separately.
 * Neither projection includes an embedding.
 */

export const PYQ_PAGE_DEFAULT_LIMIT = 20;
export const PYQ_PAGE_MAX_LIMIT = 50;

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const MAX_CURSOR_LENGTH = 512;
const MAX_PROMPT_ID_LENGTH = 200;

/** Fields the resources PYQ response reads from a unique question. */
export const UNIQUE_QUESTION_PAGE_PROJECTION = {
  _id: 1,
  questionText: 1,
  text: 1,
  appearances: 1,
  occurrenceCount: 1,
  bloomsLevel: 1,
  topic: 1,
  sourceReports: 1,
  firstSeenAt: 1,
  lastSeenAt: 1,
} as const;

/** Fields the fallback PYQ response reads from a prompt. */
export const FALLBACK_PROMPT_PROJECTION = {
  _id: 1,
  questionText: 1,
  text: 1,
  bloomsLevel: 1,
  topic: 1,
} as const;

export class InvalidQuestionBankCursorError extends Error {
  constructor() {
    super("Invalid question bank cursor");
    this.name = "InvalidQuestionBankCursorError";
  }
}

export function isInvalidQuestionBankCursorError(error: unknown): boolean {
  return (
    error instanceof InvalidQuestionBankCursorError ||
    (typeof error === "object" &&
      error !== null &&
      (error as { name?: unknown }).name === "InvalidQuestionBankCursorError")
  );
}

export type QuestionBankCursor =
  | { kind: "question"; occurrenceCount: number; id: string }
  | { kind: "prompt"; id: string };

export interface QuestionBankPage {
  questions: Array<Record<string, unknown>>;
  nextCursor: string | null;
}

export interface FallbackPromptPage {
  ids: string[];
  nextCursor: string | null;
}

export interface FallbackPyqSummary {
  uniqueQuestions: number;
  totalOccurrences: number;
  avgOccurrence: number;
  bloomsDistribution: Record<string, number>;
  subjectCount: number;
  years: string[];
  examType: string;
  reportCount: number;
  firstSeenAt: unknown;
  lastSeenAt: unknown;
}

/** A missing or unusable limit falls back to the default. Above the max, clamp. */
export function clampPyqLimit(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 1) return PYQ_PAGE_DEFAULT_LIMIT;
  return Math.min(parsed, PYQ_PAGE_MAX_LIMIT);
}

export function encodeQuestionBankCursor(input: QuestionBankCursor): string {
  const payload =
    input.kind === "question"
      ? { k: "q", c: input.occurrenceCount, id: input.id }
      : { k: "p", id: input.id };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeQuestionBankCursor(cursor: string): QuestionBankCursor {
  if (typeof cursor !== "string" || cursor.length === 0 || cursor.length > MAX_CURSOR_LENGTH) {
    throw new InvalidQuestionBankCursorError();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new InvalidQuestionBankCursorError();
  }

  if (!parsed || typeof parsed !== "object") throw new InvalidQuestionBankCursorError();
  const record = parsed as { k?: unknown; c?: unknown; id?: unknown };

  if (record.k === "q") {
    if (typeof record.c !== "number" || !Number.isInteger(record.c) || record.c < 0) {
      throw new InvalidQuestionBankCursorError();
    }
    if (typeof record.id !== "string" || !OBJECT_ID.test(record.id)) {
      throw new InvalidQuestionBankCursorError();
    }
    return { kind: "question", occurrenceCount: record.c, id: record.id };
  }

  if (record.k === "p") {
    if (typeof record.id !== "string" || record.id.length === 0 || record.id.length > MAX_PROMPT_ID_LENGTH) {
      throw new InvalidQuestionBankCursorError();
    }
    return { kind: "prompt", id: record.id };
  }

  throw new InvalidQuestionBankCursorError();
}

export interface QuestionBankFilterOptions {
  includeInactive?: boolean;
  bloomsLevel?: string;
  minOccurrence?: number;
}

/**
 * Active questions for one subject, optionally strictly after a cursor.
 * Sort is occurrenceCount descending, then _id descending.
 */
export function questionBankPageFilter(
  subject: string,
  cursor: Extract<QuestionBankCursor, { kind: "question" }> | null,
  options?: QuestionBankFilterOptions,
): Record<string, unknown> {
  const filter: Record<string, unknown> = { subject };
  if (!options?.includeInactive) filter.isActive = true;
  if (options?.bloomsLevel) filter.bloomsLevel = options.bloomsLevel;

  const cursorClause = cursor
    ? {
        $or: [
          { occurrenceCount: { $lt: cursor.occurrenceCount } },
          { occurrenceCount: cursor.occurrenceCount, _id: { $lt: cursor.id } },
        ],
      }
    : null;

  if (typeof options?.minOccurrence === "number" && cursorClause) {
    filter.$and = [{ occurrenceCount: { $gte: options.minOccurrence } }, cursorClause];
  } else if (typeof options?.minOccurrence === "number") {
    filter.occurrenceCount = { $gte: options.minOccurrence };
  } else if (cursorClause) {
    filter.$or = cursorClause.$or;
  }

  return filter;
}

/**
 * One page of distinct prompt ids referenced by a subject's public reports.
 * `limit` is the page size; the pipeline asks for one extra row so the
 * caller can tell whether another page exists.
 */
export function fallbackPromptIdPipeline(
  match: Record<string, unknown>,
  cursorId: string | null,
  limit: number,
): Record<string, unknown>[] {
  const stages: Record<string, unknown>[] = [
    { $match: match },
    { $project: { questionIds: 1 } },
    { $unwind: "$questionIds" },
    { $group: { _id: "$questionIds" } },
    { $sort: { _id: 1 } },
  ];
  if (cursorId) stages.push({ $match: { _id: { $gt: cursorId } } });
  stages.push({ $limit: limit + 1 });
  return stages;
}

/**
 * Totals for the fallback bank. The lookup keeps only `bloomsLevel`, and the
 * pipeline has no page limit, so the counts cover every published prompt.
 */
export function fallbackPyqSummaryPipeline(
  match: Record<string, unknown>,
  promptCollection: string,
): Record<string, unknown>[] {
  return [
    { $match: match },
    { $sort: { year: 1, publishedAt: -1 } },
    {
      $facet: {
        reports: [
          {
            $group: {
              _id: null,
              years: { $addToSet: "$year" },
              reportCount: { $sum: 1 },
              firstExamType: { $first: "$examType" },
              firstPublishedAt: { $first: "$publishedAt" },
              lastPublishedAt: { $last: "$publishedAt" },
            },
          },
        ],
        blooms: [
          { $project: { questionIds: 1 } },
          { $unwind: "$questionIds" },
          { $group: { _id: "$questionIds" } },
          {
            $addFields: {
              promptId: {
                $convert: { input: "$_id", to: "objectId", onError: null, onNull: null },
              },
            },
          },
          { $match: { promptId: { $ne: null } } },
          {
            $lookup: {
              from: promptCollection,
              localField: "promptId",
              foreignField: "_id",
              pipeline: [{ $project: { bloomsLevel: 1 } }],
              as: "prompt",
            },
          },
          { $unwind: "$prompt" },
          {
            $group: {
              _id: {
                $cond: [
                  { $eq: [{ $type: "$prompt.bloomsLevel" }, "string"] },
                  {
                    $cond: [
                      { $gt: [{ $strLenCP: "$prompt.bloomsLevel" }, 0] },
                      "$prompt.bloomsLevel",
                      "understand",
                    ],
                  },
                  "understand",
                ],
              },
              count: { $sum: 1 },
            },
          },
        ],
      },
    },
  ];
}

function emptyFallbackSummary(): FallbackPyqSummary {
  return {
    uniqueQuestions: 0,
    totalOccurrences: 0,
    avgOccurrence: 0,
    bloomsDistribution: {},
    subjectCount: 0,
    years: [],
    examType: "main",
    reportCount: 0,
    firstSeenAt: null,
    lastSeenAt: null,
  };
}

/** Turn the fallback aggregate into the stats block. An empty facet is zeroes. */
export function readFallbackPyqSummary(rows: unknown): FallbackPyqSummary {
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row || typeof row !== "object") return emptyFallbackSummary();

  const record = row as { reports?: unknown; blooms?: unknown };
  const report = Array.isArray(record.reports) ? record.reports[0] : null;
  const reportRecord =
    report && typeof report === "object"
      ? (report as {
          years?: unknown;
          reportCount?: unknown;
          firstExamType?: unknown;
          firstPublishedAt?: unknown;
          lastPublishedAt?: unknown;
        })
      : null;

  const years = Array.isArray(reportRecord?.years)
    ? reportRecord.years
        .filter((year): year is string => typeof year === "string" && year.length > 0)
        .sort()
    : [];

  const reportCount =
    typeof reportRecord?.reportCount === "number" &&
    Number.isFinite(reportRecord.reportCount) &&
    reportRecord.reportCount > 0
      ? Math.round(reportRecord.reportCount)
      : 0;

  const bloomsDistribution: Record<string, number> = {};
  let uniqueQuestions = 0;
  if (Array.isArray(record.blooms)) {
    for (const bucket of record.blooms) {
      if (!bucket || typeof bucket !== "object") continue;
      const level = (bucket as { _id?: unknown })._id;
      const count = (bucket as { count?: unknown }).count;
      if (typeof level !== "string" || level.length === 0) continue;
      if (typeof count !== "number" || !Number.isFinite(count) || count <= 0) continue;
      const rounded = Math.round(count);
      bloomsDistribution[level] = rounded;
      uniqueQuestions += rounded;
    }
  }

  const examType =
    typeof reportRecord?.firstExamType === "string" && reportRecord.firstExamType.length > 0
      ? reportRecord.firstExamType
      : "main";

  return {
    uniqueQuestions,
    totalOccurrences: uniqueQuestions,
    avgOccurrence: uniqueQuestions > 0 ? 1 : 0,
    bloomsDistribution,
    subjectCount: reportCount > 0 ? 1 : 0,
    years,
    examType,
    reportCount,
    firstSeenAt: reportRecord?.firstPublishedAt ?? null,
    lastSeenAt: reportRecord?.lastPublishedAt ?? null,
  };
}
