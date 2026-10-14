import { Types } from "mongoose";

/**
 * A malformed document id is a missing record. Every other read failure,
 * including a database outage, is rethrown so the route can answer 5xx.
 */
export function isAbsentIdentifierError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { name?: unknown; kind?: unknown; path?: unknown };
  const name = typeof record.name === "string" ? record.name : "";
  if (name === "BSONError" || name === "BSONTypeError") return true;
  if (name === "CastError") return record.kind === "ObjectId" || record.path === "_id";
  return false;
}

export function rethrowReadFailure(error: unknown, label: string): never {
  console.error(label, error);
  throw error;
}

/** Invalid ids stay `null`. Database failures propagate. */
export function nullIfAbsentId(error: unknown, label: string): null {
  if (isAbsentIdentifierError(error)) return null;
  console.error(label, error);
  throw error;
}

/**
 * Parse ids for an `$in` query. Ids that cannot name a document are omitted.
 * Any other parsing failure still propagates.
 */
export function objectIdsFrom(
  ids: readonly unknown[],
  create: (id: string) => Types.ObjectId = (id) => new Types.ObjectId(id),
): Types.ObjectId[] {
  const objectIds: Types.ObjectId[] = [];
  for (const id of ids) {
    if (typeof id !== "string" || id.length === 0) continue;
    try {
      objectIds.push(create(id));
    } catch (error) {
      if (!isAbsentIdentifierError(error)) throw error;
    }
  }
  return objectIds;
}
