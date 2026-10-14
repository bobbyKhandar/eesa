/**
 * Ids already written by a failed exam create, and the standalone-MongoDB
 * error that means a multi-document transaction cannot be used.
 */

const UNSUPPORTED_TRANSACTION =
  /Transaction numbers are only allowed on a replica set member or mongos|Transactions are not supported/i;

const HEX_ID = /^[a-fA-F0-9]{24}$/;

export class ExamCreationAborted extends Error {
  readonly promptIds: readonly string[];
  readonly examQuestionIds: readonly string[];
  readonly examId: string | undefined;

  constructor(
    message: string,
    ids: { promptIds?: readonly string[]; examQuestionIds?: readonly string[]; examId?: string } = {},
  ) {
    super(message);
    this.name = "ExamCreationAborted";
    this.promptIds = ids.promptIds ?? [];
    this.examQuestionIds = ids.examQuestionIds ?? [];
    this.examId = ids.examId;
  }
}

export function isTransactionsUnsupportedError(error: unknown): boolean {
  return transactionMessages(error).some((message) => UNSUPPORTED_TRANSACTION.test(message));
}

/**
 * True for this class and for the same class loaded from another module copy
 * (source and compiled output). `instanceof` alone misses that split.
 */
export function isExamCreationAborted(error: unknown): error is ExamCreationAborted {
  if (error instanceof ExamCreationAborted) return true;
  if (!error || typeof error !== "object") return false;
  const record = error as { name?: unknown; message?: unknown; promptIds?: unknown; examQuestionIds?: unknown };
  return (
    record.name === "ExamCreationAborted" &&
    typeof record.message === "string" &&
    Array.isArray(record.promptIds) &&
    Array.isArray(record.examQuestionIds)
  );
}

/**
 * Ids Mongo already stored before `insertMany` threw.
 * Ordered bulk writes keep the earlier documents when a later one fails.
 */
/**
 * Delete ids stored before a bulk write failed. Ids that could not be removed
 * are returned so the caller can try again. An empty list means they are gone.
 */
export async function deleteInsertedIds(
  ids: readonly string[],
  deleteIds: (ids: string[]) => Promise<number>,
): Promise<string[]> {
  if (ids.length === 0) return [];
  try {
    const removed = await deleteIds([...ids]);
    return removed >= ids.length ? [] : [...ids];
  } catch (error) {
    console.error("Failed to roll back documents inserted before a bulk write failed:", error);
    return [...ids];
  }
}

/**
 * Ids Mongo already stored before `insertMany` threw.
 * Ordered bulk writes keep the earlier documents when a later one fails.
 */
export function insertedIdsFromBulkError(error: unknown): string[] {
  if (!error || typeof error !== "object") return [];

  const ids: string[] = [];
  const seen = new Set<string>();
  const record = error as {
    insertedDocs?: unknown;
    insertedIds?: unknown;
    result?: { insertedIds?: unknown; result?: { insertedIds?: unknown } };
  };

  if (Array.isArray(record.insertedDocs)) {
    for (const doc of record.insertedDocs) addId(doc, ids, seen);
  }
  addIdCollection(record.insertedIds, ids, seen);
  addIdCollection(record.result?.insertedIds, ids, seen);
  addIdCollection(record.result?.result?.insertedIds, ids, seen);
  return ids;
}

function transactionMessages(error: unknown): string[] {
  const messages: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;

  for (let depth = 0; current && typeof current === "object" && depth < 6; depth += 1) {
    if (seen.has(current)) break;
    seen.add(current);
    const record = current as {
      message?: unknown;
      errmsg?: unknown;
      errorResponse?: { errmsg?: unknown };
      cause?: unknown;
      reason?: unknown;
    };
    if (typeof record.message === "string") messages.push(record.message);
    if (typeof record.errmsg === "string") messages.push(record.errmsg);
    if (typeof record.errorResponse?.errmsg === "string") messages.push(record.errorResponse.errmsg);
    current = record.cause ?? record.reason;
  }

  return messages;
}

function addId(value: unknown, ids: string[], seen: Set<string>): void {
  if (typeof value === "string") {
    pushHex(value, ids, seen);
    return;
  }
  if (!value || typeof value !== "object") return;

  const record = value as { _bsontype?: string; toString?: () => string; _id?: unknown };
  if (isObjectId(record)) {
    const text = typeof record.toString === "function" ? record.toString() : "";
    pushHex(text, ids, seen);
    return;
  }
  if ("_id" in record) addId(record._id, ids, seen);
}

function addIdCollection(value: unknown, ids: string[], seen: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) addId(item, ids, seen);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (isObjectId(value as { _bsontype?: string })) {
    addId(value, ids, seen);
    return;
  }
  for (const item of Object.values(value as Record<string, unknown>)) addId(item, ids, seen);
}

function isObjectId(value: { _bsontype?: string }): boolean {
  return value._bsontype === "ObjectId" || value.constructor?.name === "ObjectId";
}

function pushHex(value: string, ids: string[], seen: Set<string>): void {
  if (!HEX_ID.test(value) || seen.has(value)) return;
  seen.add(value);
  ids.push(value);
}
