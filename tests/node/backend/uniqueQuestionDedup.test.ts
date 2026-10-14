import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { getUniqueQuestionModel } from "../../../packages/backend/src/database/newFeatureModels.ts";
import { UniqueQuestionRepository } from "../../../packages/backend/src/database/repositories/UniqueQuestionRepository.ts";
import {
  UNIQUE_QUESTION_IDENTITY_INDEX,
  describeDedupRun,
  parseDedupArgs,
  planDuplicateMerges,
  planIdentityIndex,
  runUniqueQuestionDedup,
  type UniqueQuestionSnapshot,
} from "../../../packages/backend/src/database/uniqueQuestionDedup.ts";

const now = new Date("2026-01-15T00:00:00.000Z");

function question(overrides: Partial<UniqueQuestionSnapshot> = {}): UniqueQuestionSnapshot {
  return {
    _id: "row-a",
    questionText: "Define inertia.",
    normalizedText: "define inertia",
    subject: "Physics",
    sourceReports: ["report-1"],
    promptIds: ["prompt-1"],
    appearances: [
      { year: "2024", semester: "S1", examType: "main", analysisReportId: "report-1" },
    ],
    occurrenceCount: 1,
    firstSeenAt: new Date("2024-01-01T00:00:00.000Z"),
    lastSeenAt: new Date("2024-01-01T00:00:00.000Z"),
    topics: ["mechanics"],
    tags: [],
    isActive: true,
    isVerified: false,
    ...overrides,
  };
}

const publishInput = {
  questionText: "Define inertia.",
  normalizedText: "define inertia",
  subject: "Physics",
  subjectCode: "PHY101",
  topics: ["mechanics"],
  bloomsLevel: "remember" as const,
  promptIds: ["prompt-1"],
  tags: [],
  isVerified: false,
  isActive: true,
  sourceReports: [] as string[],
  occurrenceCount: 1,
  firstSeenAt: new Date("2024-01-01T00:00:00.000Z"),
  lastSeenAt: new Date("2024-01-01T00:00:00.000Z"),
  appearances: [] as Array<Record<string, string>>,
  analysisReportId: "report-1",
  year: "2024",
  semester: "S1",
  examType: "main" as const,
};

describe("unique question identity index", () => {
  it("declares normalizedText + subject unique", () => {
    const indexes = getUniqueQuestionModel().schema.indexes();
    const identity = indexes.find(
      ([fields]) => fields.normalizedText === 1 && fields.subject === 1 && Object.keys(fields).length === 2
    );

    assert.ok(identity);
    assert.equal(identity[1].unique, true);
    assert.equal(identity[1].name, UNIQUE_QUESTION_IDENTITY_INDEX);
  });

  it("keeps the bedrock importer on the same unique index", () => {
    const source = readFileSync(
      new URL("../../../packages/backend/src/scripts/importBedrockQuestions.ts", import.meta.url),
      "utf8"
    );
    assert.match(source, /uniqueQuestionIdentityIndex/);
    assert.doesNotMatch(source, /index\(\{ normalizedText: 1, subject: 1 \}\)/);
  });
});

describe("findOrCreate atomic upsert", () => {
  it("upserts with $setOnInsert, $inc, and $addToSet in one write", async () => {
    const repo = new UniqueQuestionRepository();
    let captured: { update: Record<string, any>; options: Record<string, unknown> } | null = null;
    (repo as unknown as { model: unknown }).model = {
      async findOneAndUpdate(_filter: unknown, update: Record<string, any>, options: Record<string, unknown>) {
        captured = { update, options };
        return {
          value: { _id: "uq-1", occurrenceCount: 1 },
          lastErrorObject: { updatedExisting: false, upserted: "uq-1" },
        };
      },
      async findOne() {
        return null;
      },
    };

    const result = await repo.findOrCreate(publishInput);

    assert.equal(result.isNew, true);
    assert.ok(captured);
    assert.equal(captured.options.upsert, true);
    assert.equal(captured.options.setDefaultsOnInsert, false);
    assert.equal(captured.update.$setOnInsert.occurrenceCount, 0);
    assert.deepEqual(captured.update.$setOnInsert.sourceReports, []);
    assert.equal(captured.update.$inc.occurrenceCount, 1);
    assert.equal(captured.update.$addToSet.sourceReports, "report-1");
    assert.deepEqual(captured.update.$addToSet.promptIds, { $each: ["prompt-1"] });
    assert.equal(captured.update.$addToSet.appearances.analysisReportId, "report-1");
  });

  it("links the row that won the insert when the unique index rejects the upsert", async () => {
    const repo = new UniqueQuestionRepository();
    const doc = {
      _id: "kept",
      normalizedText: "define inertia",
      subject: "Physics",
      sourceReports: ["report-other"],
      promptIds: ["prompt-x"],
      appearances: [] as unknown[],
      occurrenceCount: 1,
    };
    (repo as unknown as { model: unknown }).model = {
      async findOneAndUpdate(filter: Record<string, any>, update: Record<string, any>, options?: { upsert?: boolean }) {
        if (options?.upsert) {
          throw Object.assign(new Error("E11000 duplicate key error"), { code: 11000 });
        }
        if (filter.sourceReports?.$ne) {
          doc.sourceReports.push(update.$addToSet.sourceReports);
          doc.promptIds.push(...update.$addToSet.promptIds.$each);
          doc.appearances.push(update.$addToSet.appearances);
          doc.occurrenceCount += update.$inc.occurrenceCount;
          return doc;
        }
        return null;
      },
      async findOne() {
        return doc;
      },
    };

    const result = await repo.findOrCreate(publishInput);

    assert.equal(result.isNew, false);
    assert.equal(result.question, doc);
    assert.equal(doc.occurrenceCount, 2);
    assert.deepEqual(doc.sourceReports, ["report-other", "report-1"]);
    assert.deepEqual(doc.promptIds, ["prompt-x", "prompt-1"]);
    assert.equal(doc.appearances.length, 1);
  });

  it("propagates errors that are not duplicate keys", async () => {
    const repo = new UniqueQuestionRepository();
    let calls = 0;
    (repo as unknown as { model: unknown }).model = {
      async findOneAndUpdate() {
        calls += 1;
        throw new Error("connection reset");
      },
      async findOne() {
        throw new Error("find should not run");
      },
    };

    await assert.rejects(() => repo.findOrCreate(publishInput), /connection reset/);
    assert.equal(calls, 1);
  });

  it("fails the publish retry path when the row never becomes visible", async () => {
    const repo = new UniqueQuestionRepository();
    (repo as unknown as { model: unknown }).model = {
      async findOneAndUpdate(_filter: unknown, _update: unknown, options?: { upsert?: boolean }) {
        if (options?.upsert) {
          throw Object.assign(new Error("E11000 duplicate key error"), { code: 11000 });
        }
        return null;
      },
      async findOne() {
        return null;
      },
      async create() {
        throw new Error("create must not bypass the unique index");
      },
    };

    await assert.rejects(() => repo.findOrCreate(publishInput), /Unique question was not stored/);
  });
});

describe("duplicate unique question merge", () => {
  it("keeps the oldest row and unions reports without counting one report twice", () => {
    const plans = planDuplicateMerges(
      [
        question({
          _id: "newer",
          firstSeenAt: new Date("2025-01-01T00:00:00.000Z"),
          sourceReports: ["report-1", "report-2"],
          promptIds: ["prompt-2"],
          occurrenceCount: 2,
          appearances: [
            { year: "2024", semester: "S1", examType: "main", analysisReportId: "report-1" },
            { year: "2025", semester: "S1", examType: "kt", analysisReportId: "report-2" },
          ],
          subjectCode: "PHY101",
        }),
        question({
          _id: "older",
          firstSeenAt: new Date("2020-05-01T00:00:00.000Z"),
          sourceReports: ["report-1"],
          promptIds: ["prompt-1"],
          occurrenceCount: 1,
        }),
      ],
      now
    );

    assert.equal(plans.length, 1);
    assert.equal(plans[0].keeperId, "older");
    assert.deepEqual(plans[0].removeIds, ["newer"]);
    assert.deepEqual(plans[0].$set.sourceReports, ["report-1", "report-2"]);
    assert.equal(plans[0].$set.occurrenceCount, 2);
    assert.deepEqual(plans[0].$set.promptIds, ["prompt-1", "prompt-2"]);
    assert.equal((plans[0].$set.appearances as unknown[]).length, 2);
    assert.equal(plans[0].$set.subjectCode, "PHY101");
    assert.equal((plans[0].$set.firstSeenAt as Date).toISOString(), "2020-05-01T00:00:00.000Z");
    assert.equal(plans[0].$set.updatedAt, now);
  });

  it("keeps occurrence counts that were stored without a source report", () => {
    const plans = planDuplicateMerges(
      [
        question({ _id: "counted", sourceReports: [], occurrenceCount: 3, appearances: [] }),
        question({ _id: "linked", sourceReports: ["report-9"], promptIds: ["prompt-9"], occurrenceCount: 1 }),
      ],
      now
    );

    assert.equal(plans[0].$set.occurrenceCount, 4);
    assert.deepEqual(plans[0].$set.sourceReports, ["report-9"]);
  });

  it("leaves a single row and blank identities alone", () => {
    const plans = planDuplicateMerges([
      question(),
      question({ _id: "blank", normalizedText: "", subject: "Physics" }),
      question({ _id: "other-subject", subject: "Chemistry" }),
    ]);
    assert.deepEqual(plans, []);
  });

  it("stays active when any duplicate is still active", () => {
    const plans = planDuplicateMerges([
      question({ _id: "off", isActive: false, firstSeenAt: new Date("2020-01-01T00:00:00.000Z") }),
      question({ _id: "on", isActive: true, firstSeenAt: new Date("2021-01-01T00:00:00.000Z"), sourceReports: ["report-2"] }),
    ]);
    assert.equal(plans[0].keeperId, "off");
    assert.equal(plans[0].$set.isActive, true);
  });
});

describe("unique question index plan", () => {
  it("creates, replaces, or keeps the identity index", () => {
    assert.deepEqual(planIdentityIndex([]), { action: "create" });
    assert.deepEqual(
      planIdentityIndex([{ name: "normalizedText_1_subject_1", key: { normalizedText: 1, subject: 1 } }]),
      { action: "replace", drop: ["normalizedText_1_subject_1"] }
    );
    assert.deepEqual(
      planIdentityIndex([
        { name: "normalizedText_1_subject_1", key: { normalizedText: 1, subject: 1 }, unique: true },
        { name: "occurrenceCount_-1", key: { occurrenceCount: -1 } },
      ]),
      { action: "ready", name: "normalizedText_1_subject_1" }
    );
  });
});

describe("merge script safety", () => {
  it("defaults to a dry run and rejects mixed flags", () => {
    assert.deepEqual(parseDedupArgs(["node", "script"]), { apply: false });
    assert.deepEqual(parseDedupArgs(["node", "script", "--dry-run"]), { apply: false });
    assert.deepEqual(parseDedupArgs(["node", "script", "--apply"]), { apply: true });
    assert.deepEqual(parseDedupArgs(["node", "script", "--apply", "--dry-run"]), {
      error: "Pass either --apply or --dry-run.",
    });
    assert.deepEqual(parseDedupArgs(["node", "script", "--force"]), { error: "Unknown argument: --force" });
  });

  it("does not write or build an index during a dry run", async () => {
    const logs: string[] = [];
    const result = await runUniqueQuestionDedup({
      apply: false,
      now,
      log: (line) => logs.push(line),
      loadDuplicateGroups: async () => [[
        question(),
        question({
          _id: "dup",
          sourceReports: ["report-2"],
          firstSeenAt: new Date("2025-01-01T00:00:00.000Z"),
        }),
      ]],
      readIndexes: async () => [{ name: "normalizedText_1_subject_1", key: { normalizedText: 1, subject: 1 } }],
      writePlan: async () => {
        throw new Error("dry run wrote");
      },
      ensureIndex: async () => {
        throw new Error("dry run indexed");
      },
    });

    assert.equal(result.applied, false);
    assert.equal(result.duplicateGroups, 1);
    const text = logs.join("\n");
    assert.match(text, /Dry run: no unique-question documents will be written/);
    assert.match(text, /remove dup/);
    assert.match(text, /cannot be created until these duplicates are merged/);
    assert.equal(describeDedupRun({ apply: false, plans: [], indexPlan: { action: "create" } }).includes("Dry run"), true);
  });

  it("merges on --apply and builds the index only after duplicates are gone", async () => {
    const written: string[] = [];
    let loads = 0;
    let indexed = false;
    const result = await runUniqueQuestionDedup({
      apply: true,
      now,
      loadDuplicateGroups: async () => {
        loads += 1;
        if (loads === 1) {
          return [[
            question(),
            question({
              _id: "dup",
              sourceReports: ["report-2"],
              firstSeenAt: new Date("2025-01-01T00:00:00.000Z"),
            }),
          ]];
        }
        return [];
      },
      writePlan: async (plan) => {
        assert.equal(plan.removeIds.includes(plan.keeperId), false);
        written.push(String(plan.keeperId));
      },
      ensureIndex: async () => {
        indexed = true;
        return "Created unique index normalizedText_1_subject_1.";
      },
    });

    assert.equal(result.applied, true);
    assert.deepEqual(written, ["row-a"]);
    assert.equal(indexed, true);
    assert.equal(loads, 2);
  });

  it("does not build the unique index while a duplicate group remains", async () => {
    let indexed = false;
    await assert.rejects(
      () =>
        runUniqueQuestionDedup({
          apply: true,
          now,
          loadDuplicateGroups: async () => [[
            question(),
            question({
              _id: "dup",
              sourceReports: ["report-2"],
              firstSeenAt: new Date("2025-01-01T00:00:00.000Z"),
            }),
          ]],
          writePlan: async () => undefined,
          ensureIndex: async () => {
            indexed = true;
            return "should not run";
          },
        }),
      /unique index was not created/
    );
    assert.equal(indexed, false);
  });
});
