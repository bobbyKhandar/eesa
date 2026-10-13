import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { RestoreCollectionPlan } from "../../packages/backend/src/services/backupPlan.ts";
import {
  applyStagedRestore,
  asideCollectionName,
  createStagedRestoreOps,
  previousCollectionName,
  stagingCollectionName,
  toRestoreResult,
  type RestoreCollectionBinding,
  type RestoreDatabase,
} from "../../packages/backend/src/services/stagedRestore.ts";

const TOKEN = "abcd1234";

interface FakeNamespace {
  docs: unknown[];
  indexes: Array<Record<string, unknown>>;
}

class FakeDb implements RestoreDatabase {
  namespaces = new Map<string, FakeNamespace>();
  failRename: ((from: string, to: string) => Error | null) | null = null;

  seed(name: string, docs: unknown[], indexes?: Array<Record<string, unknown>>): void {
    this.namespaces.set(name, {
      docs: structuredClone(docs),
      indexes: structuredClone(
        indexes ?? [{ name: "_id_", key: { _id: 1 } }]
      ),
    });
  }

  docs(name: string): unknown[] | null {
    const namespace = this.namespaces.get(name);
    return namespace ? namespace.docs : null;
  }

  sideCollections(): string[] {
    return [...this.namespaces.keys()].filter((name) => name.startsWith("eesa_r")).sort();
  }

  listCollections(filter: { name: string }): { toArray(): Promise<Array<{ name: string }>> } {
    return {
      toArray: async () => (this.namespaces.has(filter.name) ? [{ name: filter.name }] : []),
    };
  }

  async createCollection(name: string): Promise<void> {
    if (this.namespaces.has(name)) {
      throw new Error(`collection exists: ${name}`);
    }
    this.namespaces.set(name, {
      docs: [],
      indexes: [{ name: "_id_", key: { _id: 1 } }],
    });
  }

  collection(name: string) {
    return {
      indexes: async () => {
        const namespace = this.namespaces.get(name);
        if (!namespace) {
          throw Object.assign(new Error(`ns not found: ${name}`), { code: 26, codeName: "NamespaceNotFound" });
        }
        return namespace.indexes;
      },
      createIndex: async (keys: Record<string, unknown>, options: Record<string, unknown>) => {
        const namespace = this.namespaces.get(name);
        if (!namespace) {
          throw Object.assign(new Error(`ns not found: ${name}`), { code: 26, codeName: "NamespaceNotFound" });
        }
        namespace.indexes.push({ key: keys, ...options });
      },
      rename: async (newName: string, options?: { dropTarget?: boolean }) => {
        if (options?.dropTarget) {
          throw new Error("dropTarget would delete the target collection");
        }
        const failure = this.failRename?.(name, newName);
        if (failure) throw failure;
        if (this.namespaces.has(newName)) {
          throw new Error(`target namespace exists: ${newName}`);
        }
        const namespace = this.namespaces.get(name);
        if (!namespace) {
          throw Object.assign(new Error(`ns not found: ${name}`), { code: 26, codeName: "NamespaceNotFound" });
        }
        this.namespaces.delete(name);
        this.namespaces.set(newName, namespace);
      },
      drop: async () => {
        if (!this.namespaces.delete(name)) {
          throw Object.assign(new Error(`ns not found: ${name}`), { code: 26, codeName: "NamespaceNotFound" });
        }
      },
    };
  }
}

function binding(
  name: string,
  physicalName: string,
  insertInto: RestoreCollectionBinding["insertInto"],
  validate: RestoreCollectionBinding["validate"] = async () => {}
): RestoreCollectionBinding {
  return { name, physicalName, validate, insertInto };
}

function writeAll(db: FakeDb): RestoreCollectionBinding["insertInto"] {
  return async (stagingCollection, docs) => {
    const namespace = db.namespaces.get(stagingCollection);
    if (!namespace) throw new Error(`missing staging collection ${stagingCollection}`);
    namespace.docs.push(...docs.map((doc) => structuredClone(doc)));
    return docs.length;
  };
}

const LIVE_QUESTIONS = [{ _id: "live-q" }];
const LIVE_SUBJECTS = [{ _id: "live-subject" }];
const LIVE_EXAMS = [{ _id: "live-exam" }];
const NEW_QUESTIONS = [{ _id: "new-q" }];
const NEW_SUBJECTS = [{ _id: "new-subject" }];

function seededDb(): FakeDb {
  const db = new FakeDb();
  db.seed("questions", LIVE_QUESTIONS, [
    { name: "_id_", key: { _id: 1 } },
    { name: "questionText_1", key: { questionText: 1 }, unique: true },
  ]);
  db.seed("featureSubjects", LIVE_SUBJECTS);
  db.seed("examSets", LIVE_EXAMS);
  return db;
}

function plan(): RestoreCollectionPlan[] {
  return [
    { name: "examSets", docs: [], presentInBackup: false },
    { name: "questions", docs: NEW_QUESTIONS, presentInBackup: true },
    { name: "Subject", docs: NEW_SUBJECTS, presentInBackup: true },
  ];
}

function bindings(db: FakeDb, insertSubject = writeAll(db)): RestoreCollectionBinding[] {
  return [
    binding("examSets", "examSets", writeAll(db)),
    binding("questions", "questions", writeAll(db)),
    binding("Subject", "featureSubjects", insertSubject),
  ];
}

describe("staged backup restore", () => {
  it("leaves earlier collections intact when a later staging insert fails", async () => {
    const db = seededDb();
    const insertSubject: RestoreCollectionBinding["insertInto"] = async (stagingCollection, docs) => {
      const namespace = db.namespaces.get(stagingCollection);
      if (!namespace) throw new Error(`missing staging collection ${stagingCollection}`);
      namespace.docs.push(structuredClone(docs[0]));
      throw new Error("E11000 duplicate key error");
    };
    const outcome = await applyStagedRestore(
      plan(),
      createStagedRestoreOps(db, bindings(db, insertSubject), TOKEN)
    );
    const result = toRestoreResult(outcome);

    assert.equal(result.success, false);
    assert.equal(outcome.liveDataPreserved, true);
    assert.match(result.message, /left unchanged/);
    assert.match(result.errors.Subject ?? "", /duplicate key/);
    assert.deepEqual(result.collectionCounts, {});
    assert.deepEqual(db.docs("examSets"), LIVE_EXAMS);
    assert.deepEqual(db.docs("questions"), LIVE_QUESTIONS);
    assert.deepEqual(db.docs("featureSubjects"), LIVE_SUBJECTS);
    assert.deepEqual(db.sideCollections(), []);
    assert.equal(db.namespaces.has("Subject"), false);
  });

  it("rolls published collections back when a later swap fails", async () => {
    const db = seededDb();
    db.failRename = (from, to) => {
      if (from === stagingCollectionName(TOKEN, "featureSubjects") && to === "featureSubjects") {
        return new Error("publish failed");
      }
      return null;
    };
    const outcome = await applyStagedRestore(
      plan(),
      createStagedRestoreOps(db, bindings(db), TOKEN)
    );
    const result = toRestoreResult(outcome);

    assert.equal(result.success, false);
    assert.equal(outcome.liveDataPreserved, true);
    assert.match(result.message, /left unchanged/);
    assert.match(result.errors.Subject ?? "", /publish failed/);
    assert.deepEqual(db.docs("examSets"), LIVE_EXAMS);
    assert.deepEqual(db.docs("questions"), LIVE_QUESTIONS);
    assert.deepEqual(db.docs("featureSubjects"), LIVE_SUBJECTS);
    assert.deepEqual(db.sideCollections(), []);
  });

  it("rejects invalid documents before staging any collection", async () => {
    const db = seededDb();
    let inserts = 0;
    const counting = writeAll(db);
    const tracked: RestoreCollectionBinding["insertInto"] = async (stagingCollection, docs) => {
      inserts += 1;
      return counting(stagingCollection, docs);
    };
    const validateSubject: RestoreCollectionBinding["validate"] = async () => {
      throw new Error("Document 0 failed validation: name is required");
    };
    const outcome = await applyStagedRestore(
      [
        { name: "questions", docs: [null], presentInBackup: true },
        { name: "Subject", docs: [{ bad: true }], presentInBackup: true },
      ],
      createStagedRestoreOps(
        db,
        [
          binding("questions", "questions", tracked),
          binding("Subject", "featureSubjects", tracked, validateSubject),
        ],
        TOKEN
      )
    );

    assert.equal(outcome.applied, false);
    assert.equal(outcome.liveDataPreserved, true);
    assert.equal(inserts, 0);
    assert.match(outcome.errors.questions ?? "", /not an object/);
    assert.match(outcome.errors.Subject ?? "", /not restorable|failed validation/);
    assert.deepEqual(db.docs("questions"), LIVE_QUESTIONS);
    assert.deepEqual(db.docs("featureSubjects"), LIVE_SUBJECTS);
    assert.deepEqual(db.sideCollections(), []);
  });

  it("swaps staged collections into place only after every collection is written", async () => {
    const db = seededDb();
    const outcome = await applyStagedRestore(
      plan(),
      createStagedRestoreOps(db, bindings(db), TOKEN)
    );
    const result = toRestoreResult(outcome);

    assert.equal(result.success, true);
    assert.deepEqual(result.errors, {});
    assert.match(result.message, /Restored 2 documents across 3 collections/);
    assert.deepEqual(db.docs("examSets"), []);
    assert.deepEqual(db.docs("questions"), NEW_QUESTIONS);
    assert.deepEqual(db.docs("featureSubjects"), NEW_SUBJECTS);
    assert.equal(db.namespaces.has("Subject"), false);
    assert.deepEqual(db.sideCollections(), []);
    const questionIndexes = db.namespaces.get("questions")?.indexes ?? [];
    assert.ok(
      questionIndexes.some((index) => index.name === "questionText_1" && index.unique === true)
    );
  });

  it("creates a collection that did not exist without touching the others", async () => {
    const db = new FakeDb();
    db.seed("questions", LIVE_QUESTIONS);
    const outcome = await applyStagedRestore(
      [{ name: "Subject", docs: NEW_SUBJECTS, presentInBackup: true }],
      createStagedRestoreOps(
        db,
        [binding("Subject", "featureSubjects", writeAll(db))],
        TOKEN
      )
    );

    assert.equal(outcome.applied, true);
    assert.deepEqual(db.docs("featureSubjects"), NEW_SUBJECTS);
    assert.deepEqual(db.docs("questions"), LIVE_QUESTIONS);
    assert.deepEqual(db.sideCollections(), []);
  });

  it("keeps the pre-swap copy when rolling a published collection back fails", async () => {
    const db = seededDb();
    db.failRename = (from, to) => {
      if (from === stagingCollectionName(TOKEN, "featureSubjects") && to === "featureSubjects") {
        return new Error("publish failed");
      }
      if (from === "questions" && to === asideCollectionName(TOKEN, "questions")) {
        return new Error("rollback rename failed");
      }
      return null;
    };
    const outcome = await applyStagedRestore(
      plan(),
      createStagedRestoreOps(db, bindings(db), TOKEN)
    );
    const result = toRestoreResult(outcome);
    const preservedQuestions = previousCollectionName(TOKEN, "questions");

    assert.equal(result.success, false);
    assert.equal(outcome.liveDataPreserved, false);
    assert.match(result.message, /could not be fully rolled back/);
    assert.match(result.errors.questions ?? "", /Previous documents remain/);
    assert.deepEqual(db.docs(preservedQuestions), LIVE_QUESTIONS);
    assert.deepEqual(db.docs("featureSubjects"), LIVE_SUBJECTS);
    assert.deepEqual(db.docs("examSets"), LIVE_EXAMS);
    assert.equal(db.namespaces.has(preservedQuestions), true);
  });
});
