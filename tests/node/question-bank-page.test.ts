/**
 * Resource PYQ reads page the question bank and keep totals on a separate
 * aggregate. A cursor this module did not emit is rejected. The fallback
 * path pages prompt ids and summarizes reports without returning every
 * document. Repository behavior is covered by the check spawned below.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  difficultyFromBlooms,
  mapFallbackPromptToPyq,
  mapStoredQuestionToPyq,
} from "../../packages/frontend/lib/resourceCatalog.ts";
import {
  FALLBACK_PROMPT_PROJECTION,
  PYQ_PAGE_DEFAULT_LIMIT,
  PYQ_PAGE_MAX_LIMIT,
  UNIQUE_QUESTION_PAGE_PROJECTION,
  clampPyqLimit,
  decodeQuestionBankCursor,
  encodeQuestionBankCursor,
  fallbackPromptIdPipeline,
  fallbackPyqSummaryPipeline,
  isInvalidQuestionBankCursorError,
  questionBankPageFilter,
  readFallbackPyqSummary,
} from "../../packages/backend/src/services/questionBankPage.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const QUESTION_ID = "507f1f77bcf86cd799439011";
const NEXT_ID = "507f1f77bcf86cd799439012";

describe("question bank page cursors", () => {
  it("clamps the page size and rejects a cursor it did not emit", () => {
    assert.equal(clampPyqLimit(undefined), PYQ_PAGE_DEFAULT_LIMIT);
    assert.equal(clampPyqLimit(null), PYQ_PAGE_DEFAULT_LIMIT);
    assert.equal(clampPyqLimit("0"), PYQ_PAGE_DEFAULT_LIMIT);
    assert.equal(clampPyqLimit("1.5"), PYQ_PAGE_DEFAULT_LIMIT);
    assert.equal(clampPyqLimit("7"), 7);
    assert.equal(clampPyqLimit(String(PYQ_PAGE_MAX_LIMIT + 40)), PYQ_PAGE_MAX_LIMIT);

    const questionCursor = encodeQuestionBankCursor({
      kind: "question",
      occurrenceCount: 4,
      id: QUESTION_ID,
    });
    assert.deepEqual(decodeQuestionBankCursor(questionCursor), {
      kind: "question",
      occurrenceCount: 4,
      id: QUESTION_ID,
    });

    const promptCursor = encodeQuestionBankCursor({ kind: "prompt", id: "prompt-1" });
    assert.deepEqual(decodeQuestionBankCursor(promptCursor), { kind: "prompt", id: "prompt-1" });

    const filter = questionBankPageFilter("Operating Systems", {
      kind: "question",
      occurrenceCount: 4,
      id: QUESTION_ID,
    });
    assert.equal(filter.subject, "Operating Systems");
    assert.equal(filter.isActive, true);
    assert.deepEqual(filter.$or, [
      { occurrenceCount: { $lt: 4 } },
      { occurrenceCount: 4, _id: { $lt: QUESTION_ID } },
    ]);
    assert.deepEqual(questionBankPageFilter("Operating Systems", null), {
      subject: "Operating Systems",
      isActive: true,
    });

    const bounded = questionBankPageFilter(
      "Operating Systems",
      { kind: "question", occurrenceCount: 2, id: QUESTION_ID },
      { minOccurrence: 3, bloomsLevel: "apply" },
    );
    assert.equal(bounded.bloomsLevel, "apply");
    assert.deepEqual(bounded.$and, [
      { occurrenceCount: { $gte: 3 } },
      {
        $or: [
          { occurrenceCount: { $lt: 2 } },
          { occurrenceCount: 2, _id: { $lt: QUESTION_ID } },
        ],
      },
    ]);
    assert.equal("occurrenceCount" in bounded, false);

    for (const bad of [
      "not-a-cursor",
      "x".repeat(600),
      Buffer.from("{}", "utf8").toString("base64url"),
      Buffer.from(JSON.stringify({ k: "q", c: 1, id: "nope" }), "utf8").toString("base64url"),
      Buffer.from(JSON.stringify({ k: "q", c: -1, id: QUESTION_ID }), "utf8").toString("base64url"),
      Buffer.from(JSON.stringify({ k: "p", id: "" }), "utf8").toString("base64url"),
      encodeQuestionBankCursor({ kind: "prompt", id: "prompt-1" }).slice(0, -2) + "!!",
    ]) {
      assert.throws(() => decodeQuestionBankCursor(bad), isInvalidQuestionBankCursorError);
    }
  });
});

describe("question bank projections and fallback aggregates", () => {
  it("projects the resource fields and leaves embeddings out", () => {
    assert.equal(UNIQUE_QUESTION_PAGE_PROJECTION.questionText, 1);
    assert.equal(UNIQUE_QUESTION_PAGE_PROJECTION.appearances, 1);
    assert.equal(UNIQUE_QUESTION_PAGE_PROJECTION.sourceReports, 1);
    assert.equal("embedding" in UNIQUE_QUESTION_PAGE_PROJECTION, false);
    assert.equal("clusterId" in UNIQUE_QUESTION_PAGE_PROJECTION, false);
    assert.equal(FALLBACK_PROMPT_PROJECTION.questionText, 1);
    assert.equal(FALLBACK_PROMPT_PROJECTION.bloomsLevel, 1);
    assert.equal("embedding" in FALLBACK_PROMPT_PROJECTION, false);
  });

  it("limits the fallback id page and does not limit the summary", () => {
    const match = { subjectName: "Operating Systems", isPublic: true, publishStatus: { $ne: "pending" } };
    const page = fallbackPromptIdPipeline(match, NEXT_ID, 5);
    const serialized = JSON.stringify(page);

    assert.deepEqual(page[0], { $match: match });
    assert.match(serialized, /"\$project":\{"questionIds":1\}/);
    assert.match(serialized, /"\$limit":6/);
    assert.match(serialized, /"\$gt":"507f1f77bcf86cd799439012"/);
    assert.doesNotMatch(serialized, /embedding/);
    assert.doesNotMatch(serialized, /questionText/);

    const open = fallbackPromptIdPipeline(match, null, PYQ_PAGE_DEFAULT_LIMIT);
    assert.equal(JSON.stringify(open).includes('"$gt"'), false);
    assert.match(JSON.stringify(open), new RegExp(`"\\$limit":${PYQ_PAGE_DEFAULT_LIMIT + 1}`));

    const summary = fallbackPyqSummaryPipeline(match, "prompts");
    const summaryJson = JSON.stringify(summary);
    assert.deepEqual(summary[0], { $match: match });
    assert.match(summaryJson, /"\$facet"/);
    assert.match(summaryJson, /"\$lookup"/);
    assert.match(summaryJson, /"from":"prompts"/);
    assert.match(summaryJson, /"bloomsLevel":1/);
    assert.doesNotMatch(summaryJson, /"\$limit"/);
    assert.doesNotMatch(summaryJson, /embedding/);
    assert.doesNotMatch(summaryJson, /questionText/);
  });

  it("reads fallback totals from the aggregate, not from a page of prompts", () => {
    assert.deepEqual(readFallbackPyqSummary([]), {
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
    });

    const summary = readFallbackPyqSummary([
      {
        reports: [
          {
            years: ["2024", "2022", ""],
            reportCount: 2,
            firstExamType: "kt",
            firstPublishedAt: "2022-05-01T00:00:00.000Z",
            lastPublishedAt: "2024-05-01T00:00:00.000Z",
          },
        ],
        blooms: [
          { _id: "apply", count: 2 },
          { _id: "understand", count: 1 },
        ],
      },
    ]);

    assert.equal(summary.uniqueQuestions, 3);
    assert.equal(summary.totalOccurrences, 3);
    assert.equal(summary.avgOccurrence, 1);
    assert.equal(summary.subjectCount, 1);
    assert.equal(summary.reportCount, 2);
    assert.deepEqual(summary.years, ["2022", "2024"]);
    assert.equal(summary.examType, "kt");
    assert.deepEqual(summary.bloomsDistribution, { apply: 2, understand: 1 });
    assert.equal(summary.firstSeenAt, "2022-05-01T00:00:00.000Z");
    assert.equal(summary.lastSeenAt, "2024-05-01T00:00:00.000Z");
  });
});

describe("PYQ row mapping", () => {
  it("maps a stored question without carrying unused document fields", () => {
    const row = mapStoredQuestionToPyq(
      {
        _id: QUESTION_ID,
        questionText: "Explain paging",
        embedding: [0.1, 0.2, 0.3],
        appearances: [
          { year: "2024", examType: "main" },
          { year: "2022", examType: "kt" },
        ],
        occurrenceCount: 2,
        bloomsLevel: "apply",
        topic: "Memory",
        sourceReports: ["r1", "r2"],
        firstSeenAt: "2022-01-01T00:00:00.000Z",
        lastSeenAt: "2024-01-01T00:00:00.000Z",
      },
      0,
      "Operating Systems",
    );

    assert.equal(row._id, QUESTION_ID);
    assert.equal(row.questionText, "Explain paging");
    assert.deepEqual(row.years, ["2022", "2024"]);
    assert.equal(row.examType, "main");
    assert.equal(row.frequency, 2);
    assert.equal(row.difficulty, "Medium");
    assert.deepEqual(row.topics, ["Memory"]);
    assert.equal(row.downloadCount, 0);
    assert.equal(row.sourceReports, 2);
    assert.equal("embedding" in row, false);
  });

  it("maps a fallback prompt with the shared report summary", () => {
    const row = mapFallbackPromptToPyq(
      { _id: NEXT_ID, questionText: "Define a semaphore", bloomsLevel: "remember", topic: "Sync" },
      3,
      "Operating Systems",
      {
        years: ["2023"],
        examType: "main",
        reportCount: 4,
        firstSeenAt: "2023-01-01T00:00:00.000Z",
        lastSeenAt: "2023-06-01T00:00:00.000Z",
      },
    );

    assert.equal(row._id, NEXT_ID);
    assert.equal(row.title.startsWith("Define a semaphore"), true);
    assert.deepEqual(row.years, ["2023"]);
    assert.equal(row.occurrenceCount, 1);
    assert.equal(row.difficulty, "Easy");
    assert.equal(row.sourceReports, 4);
    assert.deepEqual(row.topics, ["Sync"]);
  });

  it("keeps the Bloom difficulty buckets", () => {
    assert.equal(difficultyFromBlooms("remember"), "Easy");
    assert.equal(difficultyFromBlooms("UNDERSTAND"), "Easy");
    assert.equal(difficultyFromBlooms("apply"), "Medium");
    assert.equal(difficultyFromBlooms("analyze"), "Medium");
    assert.equal(difficultyFromBlooms("evaluate"), "Hard");
    assert.equal(difficultyFromBlooms("create"), "Hard");
    assert.equal(difficultyFromBlooms(""), "Medium");
    assert.equal(difficultyFromBlooms(undefined), "Medium");
  });
});

describe("resources PYQ API and page", () => {
  it("pages questions, projects fields, and summarizes separately from the page", () => {
    const route = read("packages/frontend/app/api/resources/route.ts");
    const repo = read("packages/backend/src/database/repositories/UniqueQuestionRepository.ts");

    assert.match(route, /clampPyqLimit\(/);
    assert.match(route, /decodeQuestionBankCursor\(/);
    assert.match(route, /getSubjectStats\(/);
    assert.match(route, /findBySubject\(\s*subject/);
    assert.match(route, /limit,/);
    assert.match(route, /summarizeFallbackPyqs\(/);
    assert.match(route, /pagePublicPromptIds\(/);
    assert.match(route, /FALLBACK_PROMPT_PROJECTION/);
    assert.match(route, /nextCursor/);
    assert.match(route, /isInvalidQuestionBankCursorError/);
    assert.match(route, /status:\s*400/);
    assert.match(route, /status:\s*500/);
    assert.doesNotMatch(route, /analysisReportRepo\.findBySubject\(/);
    assert.doesNotMatch(route, /allQuestionIds/);

    assert.match(repo, /UNIQUE_QUESTION_PAGE_PROJECTION/);
    assert.match(repo, /\.select\(\{ embedding: 0 \}\)/);
    assert.match(repo, /\.limit\(limit \+ 1\)/);
  });

  it("pages the resources table and still previews, exports, and filters the loaded rows", () => {
    const page = read("packages/frontend/app/resources/page.tsx");
    const table = read("packages/frontend/components/features/resources/PyqsTable.tsx");

    assert.match(page, /action: "pyqs"/);
    assert.match(page, /limit: String\(PYQ_PAGE_SIZE\)/);
    assert.match(page, /params\.set\("cursor", cursor\)/);
    assert.match(page, /goToNextPage/);
    assert.match(page, /goToPreviousPage/);
    assert.match(page, /filterPyqsByQuery\(/);
    assert.match(page, /visibleResourceSections\(filterType\)/);
    assert.match(page, /setError\(err\.message \|\| "Failed to load questions"\)/);
    assert.match(page, /setPyqsData\(null\)/);

    assert.match(table, /pyqsDownload\(pyqs, subjectName\)/);
    assert.match(table, /describePyq\(pyq\)/);
    assert.match(table, /aria-label=\{`Preview \$\{details\.title\}`\}/);
    assert.match(table, />\s*Next\s*</);
    assert.match(table, />\s*Previous\s*</);
  });

  it("propagates a failed page read and returns the next cursor from the last kept row", () => {
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
      if (key.startsWith("NODE_TEST") || key.startsWith("NODE_CHANNEL")) delete env[key];
    }
    env.mongodb_url = process.env.mongodb_url || "mongodb://127.0.0.1:27017/eesa-question-bank-page-test";

    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "--test", "tests/node/question-bank-page.check.ts"],
      { cwd: root, encoding: "utf8", env },
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /returns the next cursor from the last kept question/);
    assert.match(result.stdout, /limits fallback prompt ids and summarizes without a page limit/);
    assert.match(result.stdout, /# fail 0/);
  });
});
