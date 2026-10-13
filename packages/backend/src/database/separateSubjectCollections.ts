import {
  FEATURE_SUBJECT_COLLECTION,
  LEGACY_SUBJECT_COLLECTION,
  separateMixedSubjectDocuments,
  type SubjectDocumentStore,
  type SubjectSeparationResult,
} from "./subjectCollections";

interface SubjectCollectionHandle {
  find(filter: Record<string, unknown>): { toArray(): Promise<Record<string, unknown>[]> };
  findOne(filter: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  insertOne(doc: Record<string, unknown>): Promise<unknown>;
  deleteOne(filter: Record<string, unknown>): Promise<unknown>;
}

export interface SubjectSeparationConnection {
  db?: {
    collection(name: string): SubjectCollectionHandle;
  } | null;
}

const pendingByConnection = new WeakMap<object, Promise<SubjectSeparationResult>>();

function mongoSubjectStore(db: NonNullable<SubjectSeparationConnection["db"]>, name: string): SubjectDocumentStore {
  const collection = db.collection(name);
  return {
    findAll() {
      return collection.find({}).toArray();
    },
    findById(id) {
      return collection.findOne({ _id: id });
    },
    async insert(doc) {
      await collection.insertOne(doc);
    },
    async deleteById(id) {
      await collection.deleteOne({ _id: id });
    },
  };
}

/**
 * Move catalog subjects that were written into the legacy `subjects`
 * collection over to `featureSubjects`. Idempotent. The result is remembered
 * per connection so later requests do not scan the collection again. A thrown
 * error is forgotten so the next call can retry.
 */
export function ensureSubjectCollectionsSeparated(
  connection: SubjectSeparationConnection
): Promise<SubjectSeparationResult> {
  const existing = pendingByConnection.get(connection);
  if (existing) return existing;

  const pending = runSeparation(connection).catch((error: unknown) => {
    pendingByConnection.delete(connection);
    throw error;
  });
  pendingByConnection.set(connection, pending);
  return pending;
}

async function runSeparation(connection: SubjectSeparationConnection): Promise<SubjectSeparationResult> {
  const db = connection.db;
  if (!db) {
    throw new Error("MongoDB connection has no database handle");
  }

  const result = await separateMixedSubjectDocuments(
    mongoSubjectStore(db, LEGACY_SUBJECT_COLLECTION),
    mongoSubjectStore(db, FEATURE_SUBJECT_COLLECTION)
  );

  if (result.moved > 0 || result.alreadyPresent > 0 || result.failed.length > 0) {
    console.log(
      `[subject-collections] ${LEGACY_SUBJECT_COLLECTION} -> ${FEATURE_SUBJECT_COLLECTION}: ` +
        `moved ${result.moved}, already present ${result.alreadyPresent}, kept ${result.kept}, failed ${result.failed.length}`
    );
  }
  if (result.failed.length > 0) {
    console.error(
      `[subject-collections] ${result.failed.length} catalog subject(s) left in ${LEGACY_SUBJECT_COLLECTION}: ` +
        result.failed
          .slice(0, 5)
          .map((failure) => `${failure.id}: ${failure.error}`)
          .join("; ")
    );
  }

  return result;
}
