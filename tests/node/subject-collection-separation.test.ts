import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";

import { findDuplicatePhysicalCollections } from "../../packages/backend/src/database/managedCollections.ts";
import {
  FEATURE_SUBJECT_COLLECTION,
  LEGACY_SUBJECT_COLLECTION,
  isFeatureSubjectDocument,
  isLegacySubjectDocument,
  planSubjectSeparation,
  separateMixedSubjectDocuments,
  type SubjectDocumentStore,
} from "../../packages/backend/src/database/subjectCollections.ts";
import { ensureSubjectCollectionsSeparated } from "../../packages/backend/src/database/separateSubjectCollections.ts";

function readRepoFile(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const legacySubject = {
  _id: "legacy-1",
  subjectName: "Physics",
  subjectDescription: "Question bank for Physics",
  analysisReportIds: ["report-1"],
};

const featureSubject = {
  _id: "feature-1",
  name: "Data Structures",
  code: "CS201",
  branch: "Computer Science",
  year: "SY",
  semester: "Semester 3",
  credits: 4,
  description: "Trees and graphs",
  createdBy: "user-1",
};

describe("subject model collection names", () => {
  it("would collide under Mongoose's default pluralization", () => {
    const isolated = new mongoose.Mongoose();
    const legacy = isolated.model("subjects", new isolated.Schema({ subjectName: String }));
    const feature = isolated.model("Subject", new isolated.Schema({ name: String }));
    assert.equal(legacy.collection.collectionName, "subjects");
    assert.equal(feature.collection.collectionName, "subjects");
  });

  it("binds the registered models to distinct physical collections", () => {
    assert.equal(LEGACY_SUBJECT_COLLECTION, "subjects");
    assert.equal(FEATURE_SUBJECT_COLLECTION, "featureSubjects");
    assert.notEqual(LEGACY_SUBJECT_COLLECTION, FEATURE_SUBJECT_COLLECTION);

    // mongooseSchemas.ts imports types as values, which node --experimental-strip-types
    // cannot load. tsx compiles those imports, so this check uses the real models.
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "tests/node/subject-model-collections.check.ts"],
      { encoding: "utf8", cwd: fileURLToPath(new URL("../..", import.meta.url)) }
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  });
});

describe("findDuplicatePhysicalCollections", () => {
  it("reports registry entries that share one MongoDB collection", () => {
    assert.deepEqual(
      findDuplicatePhysicalCollections([
        { name: "subjects", collectionName: "subjects" },
        { name: "Subject", collectionName: "subjects" },
      ]),
      ['subjects and Subject both use "subjects"']
    );
  });

  it("accepts distinct physical collections", () => {
    assert.deepEqual(
      findDuplicatePhysicalCollections([
        { name: "subjects", collectionName: "subjects" },
        { name: "Subject", collectionName: "featureSubjects" },
      ]),
      []
    );
  });
});

describe("subject document classification", () => {
  it("treats question-bank rows as legacy", () => {
    assert.equal(isLegacySubjectDocument(legacySubject), true);
    assert.equal(isFeatureSubjectDocument(legacySubject), false);
  });

  it("treats catalog rows as feature subjects", () => {
    assert.equal(isFeatureSubjectDocument(featureSubject), true);
    assert.equal(isLegacySubjectDocument(featureSubject), false);
  });

  it("keeps a row that has both shapes on the legacy collection", () => {
    const mixed = { ...featureSubject, _id: "mixed-1", subjectName: "Data Structures" };
    assert.equal(isFeatureSubjectDocument(mixed), false);
    const plan = planSubjectSeparation([legacySubject, featureSubject, mixed]);
    assert.deepEqual(plan.move.map((doc) => doc._id), ["feature-1"]);
    assert.deepEqual(plan.keep.map((doc) => doc._id), ["legacy-1", "mixed-1"]);
  });

  it("does not move question-bank rows that only have a feature-like code", () => {
    const bank = { ...featureSubject, _id: "bank-1", analysisReportIds: ["report-9"] };
    assert.equal(isFeatureSubjectDocument(bank), false);
  });

  it("rejects codes that are not XX###", () => {
    assert.equal(isFeatureSubjectDocument({ ...featureSubject, code: "cs201" }), false);
    assert.equal(isFeatureSubjectDocument({ ...featureSubject, code: "C201" }), false);
    assert.equal(isFeatureSubjectDocument({ ...featureSubject, name: "  " }), false);
  });
});

function memoryStore(seed: Record<string, unknown>[]): SubjectDocumentStore & { docs: Record<string, unknown>[] } {
  const docs = seed.map((doc) => ({ ...doc }));
  return {
    docs,
    async findAll() {
      return docs.map((doc) => ({ ...doc }));
    },
    async findById(id) {
      return docs.find((doc) => doc._id === id) ?? null;
    },
    async insert(doc) {
      if (docs.some((existing) => existing._id === doc._id)) {
        throw new Error(`E11000 duplicate key _id ${String(doc._id)}`);
      }
      docs.push({ ...doc });
    },
    async deleteById(id) {
      const index = docs.findIndex((doc) => doc._id === id);
      if (index >= 0) docs.splice(index, 1);
    },
  };
}

describe("separateMixedSubjectDocuments", () => {
  it("copies feature rows out of the legacy collection and leaves question-bank rows", async () => {
    const legacy = memoryStore([legacySubject, featureSubject, { ...featureSubject, _id: "feature-2", code: "MA101", name: "Calculus" }]);
    const feature = memoryStore([]);

    const result = await separateMixedSubjectDocuments(legacy, feature);

    assert.equal(result.moved, 2);
    assert.equal(result.kept, 1);
    assert.equal(result.alreadyPresent, 0);
    assert.deepEqual(result.failed, []);
    assert.deepEqual(legacy.docs.map((doc) => doc._id), ["legacy-1"]);
    assert.deepEqual(feature.docs.map((doc) => doc._id), ["feature-1", "feature-2"]);
    assert.equal(feature.docs[0].name, "Data Structures");
    assert.equal(feature.docs[0].code, "CS201");
  });

  it("is idempotent and finishes a copy that was inserted but not deleted", async () => {
    const legacy = memoryStore([legacySubject, featureSubject]);
    const feature = memoryStore([{ ...featureSubject }]);

    const first = await separateMixedSubjectDocuments(legacy, feature);
    assert.equal(first.moved, 0);
    assert.equal(first.alreadyPresent, 1);
    assert.deepEqual(legacy.docs.map((doc) => doc._id), ["legacy-1"]);

    const second = await separateMixedSubjectDocuments(legacy, feature);
    assert.deepEqual(second, { moved: 0, kept: 1, alreadyPresent: 0, failed: [] });
    assert.equal(feature.docs.length, 1);
  });

  it("leaves a feature row in place when it has no _id", async () => {
    const untitled = { ...featureSubject };
    delete (untitled as { _id?: string })._id;
    const legacy = memoryStore([untitled]);
    const feature = memoryStore([]);
    const result = await separateMixedSubjectDocuments(legacy, feature);
    assert.equal(result.moved, 0);
    assert.equal(result.failed.length, 1);
    assert.equal(legacy.docs.length, 1);
    assert.equal(feature.docs.length, 0);
  });

  it("does not delete the source when the destination insert fails", async () => {
    const legacy = memoryStore([featureSubject]);
    const feature = memoryStore([]);
    feature.insert = async () => {
      throw new Error("connection reset");
    };

    const result = await separateMixedSubjectDocuments(legacy, feature);
    assert.equal(result.moved, 0);
    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0].id, "feature-1");
    assert.match(result.failed[0].error, /connection reset/);
    assert.deepEqual(legacy.docs.map((doc) => doc._id), ["feature-1"]);
  });
});

describe("ensureSubjectCollectionsSeparated", () => {
  it("moves matching documents through the database handle and does not repeat a clean run", async () => {
    const calls = { inserts: 0, deletes: 0 };
    const legacyDocs = [{ ...featureSubject }, { ...legacySubject }];
    const featureDocs: Record<string, unknown>[] = [];
    const db = {
      collection(name: string) {
        const docs = name === "subjects" ? legacyDocs : featureDocs;
        return {
          find() {
            return { toArray: async () => docs.map((doc) => ({ ...doc })) };
          },
          async findOne(filter: { _id?: unknown }) {
            return docs.find((doc) => doc._id === filter._id) ?? null;
          },
          async insertOne(doc: Record<string, unknown>) {
            calls.inserts += 1;
            docs.push({ ...doc });
          },
          async deleteOne(filter: { _id?: unknown }) {
            calls.deletes += 1;
            const index = docs.findIndex((doc) => doc._id === filter._id);
            if (index >= 0) docs.splice(index, 1);
          },
        };
      },
    };

    const connection = { db };
    const first = await ensureSubjectCollectionsSeparated(connection);
    assert.equal(first.moved, 1);
    assert.equal(calls.inserts, 1);
    assert.equal(calls.deletes, 1);
    assert.deepEqual(legacyDocs.map((doc) => doc._id), ["legacy-1"]);
    assert.equal(featureDocs[0]._id, "feature-1");

    const second = await ensureSubjectCollectionsSeparated(connection);
    assert.equal(second, first);
    assert.equal(calls.inserts, 1);
  });

  it("retries after a thrown failure instead of caching it", async () => {
    const connection: {
      db?: {
        collection(name: string): {
          find(filter: Record<string, unknown>): { toArray(): Promise<Record<string, unknown>[]> };
          findOne(filter: Record<string, unknown>): Promise<Record<string, unknown> | null>;
          insertOne(doc: Record<string, unknown>): Promise<unknown>;
          deleteOne(filter: Record<string, unknown>): Promise<unknown>;
        };
      };
    } = {};

    await assert.rejects(
      () => ensureSubjectCollectionsSeparated(connection),
      /no database handle/
    );

    connection.db = {
      collection() {
        return {
          find() {
            return { toArray: async () => [] };
          },
          async findOne() {
            return null;
          },
          async insertOne() {
            return undefined;
          },
          async deleteOne() {
            return undefined;
          },
        };
      },
    };

    const result = await ensureSubjectCollectionsSeparated(connection);
    assert.deepEqual(result, { moved: 0, kept: 0, alreadyPresent: 0, failed: [] });
  });
});

describe("subject collection wiring", () => {
  it("separates collections when the app connects and when the bedrock importer connects directly", () => {
    const connectSource = readRepoFile("packages/backend/src/database/connect.ts");
    const importer = readRepoFile("packages/backend/src/scripts/importBedrockQuestions.ts");
    assert.match(connectSource, /ensureSubjectCollectionsSeparated/);
    assert.match(importer, /ensureSubjectCollectionsSeparated/);
    assert.match(importer, /LEGACY_SUBJECT_COLLECTION/);
    assert.doesNotMatch(importer, /model\(\s*['"]Subject['"]/);
  });
});
