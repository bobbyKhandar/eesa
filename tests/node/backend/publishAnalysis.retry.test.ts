import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { publicAnalysisReportFilter } from "../../../packages/backend/src/database/repositories/AnalysisReportRepository.ts";
import { UniqueQuestionRepository } from "../../../packages/backend/src/database/repositories/UniqueQuestionRepository.ts";
import { pairPublishedQuestions } from "../../../packages/backend/src/services/analysisHelpers.ts";
import {
  isPublicationComplete,
  publishExamAnalysisWithPorts,
  type PublishAnalysisPorts,
} from "../../../packages/backend/src/services/publishAnalysisMachine.ts";

/**
 * Minimal Mongo operator stand-in for the unique-question upsert.
 * Supports the operators `findOrCreate` uses so the test runs the real
 * repository without a database.
 */
class MemoryCollection {
  docs: Array<Record<string, any>> = [];
  private seq = 0;

  async findOne(filter: Record<string, unknown>) {
    return this.docs.find((doc) => matches(doc, filter)) ?? null;
  }

  async findByIdAndUpdate(
    id: string,
    update: Record<string, any>,
    options?: { new?: boolean }
  ) {
    const doc = this.docs.find((entry) => entry._id === id);
    if (!doc) return null;
    applyUpdate(doc, update);
    return options?.new === false ? { ...doc } : doc;
  }

  async findOneAndUpdate(
    filter: Record<string, unknown>,
    update: Record<string, any>,
    options?: { new?: boolean }
  ) {
    const doc = this.docs.find((entry) => matches(entry, filter));
    if (!doc) return null;
    applyUpdate(doc, update);
    return options?.new === false ? { ...doc } : doc;
  }

  async updateOne(
    filter: Record<string, unknown>,
    update: Record<string, any>,
    options?: { upsert?: boolean }
  ) {
    const existing = this.docs.find((entry) => matches(entry, filter));
    if (!existing) {
      if (!options?.upsert) return { matchedCount: 0, upsertedCount: 0 };
      const doc: Record<string, any> = {
        _id: `uq-${++this.seq}`,
        ...(update.$setOnInsert ?? {}),
      };
      this.docs.push(doc);
      return { matchedCount: 0, upsertedCount: 1, upsertedId: doc._id };
    }
    applyUpdate(existing, update);
    return { matchedCount: 1, upsertedCount: 0 };
  }

  async create(data: Record<string, any>) {
    const doc = { _id: `uq-${++this.seq}`, ...data };
    this.docs.push(doc);
    return doc;
  }
}

function matches(doc: Record<string, any>, filter: Record<string, unknown>): boolean {
  for (const [key, expected] of Object.entries(filter)) {
    if (isOperator(expected, "$ne")) {
      const actual = doc[key];
      const forbidden = (expected as { $ne: unknown }).$ne;
      if (Array.isArray(actual)) {
        if (actual.some((item) => deepEqual(item, forbidden))) return false;
      } else if (deepEqual(actual, forbidden)) {
        return false;
      }
      continue;
    }

    const actual = doc[key];
    if (Array.isArray(actual)) {
      if (!actual.some((item) => deepEqual(item, expected))) return false;
      continue;
    }
    if (!deepEqual(actual, expected)) return false;
  }
  return true;
}

function applyUpdate(doc: Record<string, any>, update: Record<string, any>) {
  if (update.$set) Object.assign(doc, update.$set);
  if (update.$inc) {
    for (const [key, amount] of Object.entries(update.$inc)) {
      doc[key] = (typeof doc[key] === "number" ? doc[key] : 0) + (amount as number);
    }
  }
  if (update.$addToSet) {
    for (const [key, value] of Object.entries(update.$addToSet)) {
      const current = Array.isArray(doc[key]) ? doc[key] : [];
      const incoming =
        value && typeof value === "object" && "$each" in (value as object)
          ? (value as { $each: unknown[] }).$each
          : [value];
      for (const item of incoming) {
        if (!current.some((existing: unknown) => deepEqual(existing, item))) {
          current.push(item);
        }
      }
      doc[key] = current;
    }
  }
}

function isOperator(value: unknown, operator: string): boolean {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && operator in (value as object);
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function uniqueQuestionRepo() {
  const repo = new UniqueQuestionRepository();
  const memory = new MemoryCollection();
  (repo as unknown as { model: MemoryCollection }).model = memory;
  return { repo, memory };
}

const questionInput = {
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

describe("unique question publication upsert", () => {
  it("links a report once when the same publication is written again", async () => {
    const { repo, memory } = uniqueQuestionRepo();

    const first = await repo.findOrCreate(questionInput);
    const second = await repo.findOrCreate({
      ...questionInput,
      promptIds: ["prompt-1"],
    });

    assert.equal(first.isNew, true);
    assert.equal(second.isNew, false);
    assert.equal(memory.docs.length, 1);
    assert.equal(memory.docs[0].occurrenceCount, 1);
    assert.deepEqual(memory.docs[0].sourceReports, ["report-1"]);
    assert.equal(memory.docs[0].appearances.length, 1);
    assert.deepEqual(memory.docs[0].promptIds, ["prompt-1"]);
  });

  it("still counts a different report as another occurrence", async () => {
    const { repo, memory } = uniqueQuestionRepo();

    await repo.findOrCreate(questionInput);
    const again = await repo.findOrCreate({
      ...questionInput,
      analysisReportId: "report-2",
      promptIds: ["prompt-9"],
    });

    assert.equal(again.isNew, false);
    assert.equal(memory.docs.length, 1);
    assert.equal(memory.docs[0].occurrenceCount, 2);
    assert.deepEqual(memory.docs[0].sourceReports, ["report-1", "report-2"]);
    assert.deepEqual(memory.docs[0].promptIds, ["prompt-1", "prompt-9"]);
  });
});

describe("publication completeness", () => {
  it("treats only a finished report as already published", () => {
    assert.equal(isPublicationComplete(null, { status: "completed" }), false);
    assert.equal(
      isPublicationComplete({ publishStatus: "complete" }, { status: "completed" }),
      true
    );
    assert.equal(
      isPublicationComplete({ publishStatus: "pending" }, { status: "published", isPublished: true }),
      false
    );
    assert.equal(
      isPublicationComplete({}, { status: "published", isPublished: true }),
      true
    );
    assert.equal(
      isPublicationComplete({}, { status: "completed", isPublished: false }),
      false
    );
  });

  it("keeps pending reports out of the public question bank", () => {
    assert.deepEqual(publicAnalysisReportFilter({ subjectName: "Physics" }), {
      subjectName: "Physics",
      isPublic: true,
      publishStatus: { $ne: "pending" },
    });
  });
});

describe("pairPublishedQuestions", () => {
  it("reuses saved prompt ids and leaves questions that never got a prompt", () => {
    const questions = [
      { questionText: "Define inertia." },
      { questionText: "   " },
      { questionText: "State Newton's first law." },
    ];
    const texts = new Map<string, string | null>([["prompt-1", "Define inertia."]]);

    const { paired, unmatched } = pairPublishedQuestions(questions, ["prompt-1"], texts);

    assert.deepEqual(
      paired.map((entry) => [entry.promptId, entry.question.questionText]),
      [["prompt-1", "Define inertia."]]
    );
    assert.deepEqual(
      unmatched.map((question) => question.questionText),
      ["State Newton's first law."]
    );
  });
});

function sampleAnalysis(overrides: Record<string, unknown> = {}) {
  return {
    status: "completed",
    isPublished: false,
    analyzedBy: "user-1",
    subjectName: "Physics",
    subjectCode: "PHY101",
    branch: "Science",
    year: "2024",
    semester: "S1",
    examType: "main" as const,
    totalMarks: 10,
    bloomDistribution: {
      Recall: 100,
      Understand: 0,
      Apply: 0,
      Analyze: 0,
      Evaluate: 0,
      Create: 0,
    },
    overallAssessment: "Balanced",
    originalFile: { fileName: "physics.pdf", fileUrl: "https://example.test/physics.pdf" },
    tags: ["mechanics"],
    questions: [
      { questionText: "Define inertia.", bloomLevel: "Recall", keywords: ["mass"], marks: 4 },
      { questionText: "State Newton's first law.", bloomLevel: "Understand", keywords: ["force"], marks: 6 },
    ],
    ...overrides,
  };
}

function publicationHarness() {
  const { repo, memory } = uniqueQuestionRepo();
  const analyses = new Map<string, ReturnType<typeof sampleAnalysis>>();
  const reports: Array<Record<string, any>> = [];
  const prompts: Array<Record<string, any>> = [];
  const state = {
    uniqueCalls: 0,
    failOnUniqueCall: 0,
    subjectLinks: 0,
    analysisUpdates: 0,
    reportsCreated: 0,
  };

  const ports: PublishAnalysisPorts = {
    async connect() {},
    async findAnalysis(id) {
      return analyses.get(id) ?? null;
    },
    async updateAnalysis(id, patch) {
      const analysis = analyses.get(id);
      if (!analysis) return { success: false, error: "Analysis not found" };
      Object.assign(analysis, patch);
      state.analysisUpdates += 1;
      return { success: true };
    },
    async findReport(examAnalysisId) {
      return (
        reports.find((report) => report.examAnalysisId === examAnalysisId) ?? null
      );
    },
    async createReport(data) {
      state.reportsCreated += 1;
      const report = { ...data, _id: `report-${state.reportsCreated}` };
      reports.push(report);
      return report;
    },
    async updateReport(id, patch) {
      const report = reports.find((entry) => entry._id === id);
      if (!report) return null;
      Object.assign(report, patch);
      return report;
    },
    async createPrompt(data) {
      const promptId = `prompt-${prompts.length + 1}`;
      prompts.push({ ...data, promptId, questionText: data.questionText });
      return { success: true, promptId };
    },
    async findPrompt(promptId) {
      return prompts.find((prompt) => prompt.promptId === promptId) ?? null;
    },
    async findOrCreateUnique(data) {
      state.uniqueCalls += 1;
      if (state.uniqueCalls === state.failOnUniqueCall) {
        throw new Error("unique question write failed");
      }
      return repo.findOrCreate(data);
    },
    async addReportToSubject() {
      state.subjectLinks += 1;
    },
  };

  return { ports, analyses, reports, prompts, memory, state };
}

describe("publishExamAnalysis retry", () => {
  it("resumes a publication that failed while writing unique questions", async () => {
    const { ports, analyses, reports, prompts, memory, state } = publicationHarness();
    analyses.set("analysis-1", sampleAnalysis());
    state.failOnUniqueCall = 2;

    const failed = await publishExamAnalysisWithPorts(ports, "analysis-1", "user-1");

    assert.equal(failed.success, false);
    assert.match(failed.error ?? "", /unique question write failed/);
    assert.equal(reports.length, 1);
    assert.equal(reports[0].publishStatus, "pending");
    assert.equal(reports[0].isPublic, false);
    assert.equal(reports[0].questionIds.length, 2);
    assert.equal(analyses.get("analysis-1")?.status, "completed");
    assert.equal(analyses.get("analysis-1")?.isPublished, false);
    assert.equal(state.subjectLinks, 0);
    assert.equal(memory.docs.length, 1);
    assert.equal(memory.docs[0].occurrenceCount, 1);
    assert.equal(prompts.length, 2);

    state.failOnUniqueCall = 0;
    const retried = await publishExamAnalysisWithPorts(ports, "analysis-1", "user-1");

    assert.equal(retried.success, true);
    assert.equal(retried.reportId, reports[0]._id);
    assert.equal(reports.length, 1);
    assert.equal(state.reportsCreated, 1);
    assert.equal(reports[0].publishStatus, "complete");
    assert.equal(reports[0].isPublic, true);
    assert.equal(analyses.get("analysis-1")?.status, "published");
    assert.equal(analyses.get("analysis-1")?.isPublished, true);
    assert.equal(prompts.length, 2);
    assert.equal(memory.docs.length, 2);
    assert.equal(memory.docs[0].occurrenceCount, 1);
    assert.equal(memory.docs[1].occurrenceCount, 1);
    assert.deepEqual(memory.docs[0].sourceReports, [reports[0]._id]);
    assert.equal(state.subjectLinks, 1);

    const duplicate = await publishExamAnalysisWithPorts(ports, "analysis-1", "user-1");

    assert.equal(duplicate.success, false);
    assert.equal(duplicate.error, "This analysis has already been published");
    assert.equal(reports.length, 1);
    assert.equal(prompts.length, 2);
    assert.equal(memory.docs[0].occurrenceCount, 1);
    assert.equal(state.subjectLinks, 1);
    assert.equal(state.analysisUpdates, 1);
  });

  it("resumes a legacy partial report that has no publish status", async () => {
    const { ports, analyses, reports, prompts, memory, state } = publicationHarness();
    analyses.set("legacy-analysis", sampleAnalysis({
      questions: [
        { questionText: "Define inertia.", bloomLevel: "Recall", keywords: ["mass"], marks: 4 },
      ],
    }));
    prompts.push({ promptId: "prompt-legacy", questionText: "Define inertia." });
    reports.push({
      _id: "legacy-report",
      examAnalysisId: "legacy-analysis",
      questionIds: ["prompt-legacy"],
      isPublic: true,
    });

    const result = await publishExamAnalysisWithPorts(ports, "legacy-analysis", "user-1");

    assert.equal(result.success, true);
    assert.equal(result.reportId, "legacy-report");
    assert.equal(state.reportsCreated, 0);
    assert.equal(prompts.length, 1);
    assert.equal(reports[0].publishStatus, "complete");
    assert.equal(analyses.get("legacy-analysis")?.status, "published");
    assert.equal(memory.docs.length, 1);
    assert.equal(memory.docs[0].occurrenceCount, 1);
  });

  it("rejects a legacy report whose analysis was already published", async () => {
    const { ports, analyses, reports, prompts, state } = publicationHarness();
    analyses.set("done-analysis", sampleAnalysis({
      status: "published",
      isPublished: true,
    }));
    reports.push({
      _id: "done-report",
      examAnalysisId: "done-analysis",
      questionIds: ["prompt-done"],
      isPublic: true,
    });

    const result = await publishExamAnalysisWithPorts(ports, "done-analysis", "user-1");

    assert.equal(result.success, false);
    assert.equal(result.error, "This analysis has already been published");
    assert.equal(state.reportsCreated, 0);
    assert.equal(prompts.length, 0);
    assert.equal(state.uniqueCalls, 0);
  });

  it("finishes a pending report when the analysis was already marked published", async () => {
    const { ports, analyses, reports, prompts, state } = publicationHarness();
    analyses.set("half-analysis", sampleAnalysis({
      status: "published",
      isPublished: true,
      questions: [
        { questionText: "Define inertia.", bloomLevel: "Recall", keywords: [], marks: 4 },
      ],
    }));
    prompts.push({ promptId: "prompt-half", questionText: "Define inertia." });
    reports.push({
      _id: "half-report",
      examAnalysisId: "half-analysis",
      questionIds: ["prompt-half"],
      publishStatus: "pending",
      isPublic: false,
    });

    const result = await publishExamAnalysisWithPorts(ports, "half-analysis", "user-1");

    assert.equal(result.success, true);
    assert.equal(result.reportId, "half-report");
    assert.equal(reports[0].publishStatus, "complete");
    assert.equal(reports[0].isPublic, true);
    assert.equal(state.analysisUpdates, 0);
    assert.equal(prompts.length, 1);
    assert.equal(state.reportsCreated, 0);
  });

  it("rejects an analysis that is not completed and has no partial report", async () => {
    const { ports, analyses, state } = publicationHarness();
    analyses.set("processing-analysis", sampleAnalysis({ status: "processing" }));

    const result = await publishExamAnalysisWithPorts(ports, "processing-analysis", "user-1");

    assert.equal(result.success, false);
    assert.equal(result.error, "Only completed analyses can be published");
    assert.equal(state.reportsCreated, 0);
  });
});
