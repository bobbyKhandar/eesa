import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildAutoSubjectDocument,
  buildPromptStats,
  canImportFromJob,
  escapeRegExp,
  normalizeBloomLevel,
  normalizeExamType,
  normalizeSubjectCode,
  normalizeSubjectYear,
  parseBoundedInt,
  parseSortField,
  parseSortOrder,
  promptToUniqueQuestion,
  queryPrompts,
  safeDecodeParam,
  toBloomPercentages,
  toPromptBloomLevel,
  toUniqueQuestionList,
  toUniqueQuestionStats,
  type PromptLike,
} from "../../../packages/frontend/lib/subjectQuestionBank.ts";

describe("canImportFromJob", () => {
  it("allows only the admin role", () => {
    assert.equal(canImportFromJob("admin"), true);
    assert.equal(canImportFromJob("student"), false);
    assert.equal(canImportFromJob("teacher"), false);
    assert.equal(canImportFromJob(undefined), false);
    assert.equal(canImportFromJob(null), false);
  });
});

describe("escapeRegExp", () => {
  it("escapes regex metacharacters so user input matches literally", () => {
    assert.equal(escapeRegExp("("), "\\(");
    assert.equal(escapeRegExp(".*"), "\\.\\*");
    assert.equal(escapeRegExp("a+b"), "a\\+b");
    assert.equal(escapeRegExp("[test]"), "\\[test\\]");
  });

  it("leaves plain text untouched", () => {
    assert.equal(escapeRegExp("binary tree"), "binary tree");
  });
});

describe("parseBoundedInt", () => {
  it("parses valid integers", () => {
    assert.equal(parseBoundedInt("5"), 5);
    assert.equal(parseBoundedInt(" 7 "), 7);
    assert.equal(parseBoundedInt("0", { min: 1 }), undefined);
  });

  it("rejects values that would reach Mongo as NaN", () => {
    // NaN in a $gte filter throws a BSONError at query time.
    assert.equal(parseBoundedInt("abc"), undefined);
    assert.equal(parseBoundedInt("1.5"), undefined);
    assert.equal(parseBoundedInt("1e3"), undefined);
    assert.equal(parseBoundedInt(""), undefined);
    assert.equal(parseBoundedInt(null), undefined);
  });

  it("enforces bounds", () => {
    assert.equal(parseBoundedInt("500", { max: 200 }), undefined);
    assert.equal(parseBoundedInt("1", { min: 1, max: 200 }), 1);
  });
});

describe("parseSortField / parseSortOrder", () => {
  it("only allows known sort fields", () => {
    assert.equal(parseSortField("occurrenceCount"), "occurrenceCount");
    assert.equal(parseSortField("lastSeenAt"), "lastSeenAt");
    assert.equal(parseSortField("questionText"), undefined);
    assert.equal(parseSortField("$where"), undefined);
  });

  it("only allows asc/desc", () => {
    assert.equal(parseSortOrder("asc"), "asc");
    assert.equal(parseSortOrder("desc"), "desc");
    assert.equal(parseSortOrder("sideways"), undefined);
  });
});

describe("normalizeBloomLevel", () => {
  it("normalises both spellings to the lowercase prompt format", () => {
    assert.equal(normalizeBloomLevel("Recall"), "remember");
    assert.equal(normalizeBloomLevel("remember"), "remember");
    assert.equal(normalizeBloomLevel("  UNDERSTAND "), "understand");
  });

  it("accepts the British spelling the pipeline emits", () => {
    assert.equal(normalizeBloomLevel("Analyse"), "analyze");
  });

  it("returns null for unknown values so filters do not match everything", () => {
    assert.equal(normalizeBloomLevel(""), null);
    assert.equal(normalizeBloomLevel(undefined), null);
    assert.equal(normalizeBloomLevel(42), null);
  });

  it("defaults unknown pipeline levels to understand", () => {
    assert.equal(toPromptBloomLevel("Apply"), "apply");
    assert.equal(toPromptBloomLevel("nonsense"), "understand");
  });
});

describe("toBloomPercentages", () => {
  it("returns percentages that total 100", () => {
    const result = toBloomPercentages(["Recall", "Recall", "Understand", "Apply"]);
    assert.deepEqual(result, {
      Recall: 50,
      Understand: 25,
      Apply: 25,
      Analyze: 0,
      Evaluate: 0,
      Create: 0,
    });
    const total = Object.values(result).reduce((sum, value) => sum + value, 0);
    assert.equal(total, 100);
  });

  it("stays inside the 0..100 range the schema validates", () => {
    // Counts, not percentages, are what the old code persisted.
    const result = toBloomPercentages(Array(300).fill("Recall"));
    assert.equal(result.Recall, 100);
    assert.equal(result.Understand, 0);
  });

  it("handles an even split without drift", () => {
    const result = toBloomPercentages(["Recall", "Understand", "Apply", "Analyze"]);
    assert.equal(result.Recall, 25);
    assert.equal(result.Understand, 25);
    assert.equal(result.Apply, 25);
    assert.equal(result.Analyze, 25);
    assert.equal(Object.values(result).reduce((sum, value) => sum + value, 0), 100);
  });

  it("ignores unknown levels and empty input", () => {
    assert.deepEqual(toBloomPercentages([]), {
      Recall: 0,
      Understand: 0,
      Apply: 0,
      Analyze: 0,
      Evaluate: 0,
      Create: 0,
    });
    assert.equal(toBloomPercentages(["junk", null]).Recall, 0);
  });
});

describe("promptToUniqueQuestion", () => {
  const prompt: PromptLike = {
    _id: "abc123",
    questionText: "Explain Red-Black trees.",
    subject: "Data Structures",
    bloomLevel: "Understand",
    topicsCovered: ["Trees"],
    keywords: ["rbtree"],
    appearanceFrequency: { count: 3, years: [2023, 2024] },
    hasSimilarQuestions: true,
    createdAt: "2024-05-01T10:00:00.000Z",
  };

  it("projects prompts into the shape the subject page expects", () => {
    const result = promptToUniqueQuestion(prompt);
    assert.equal(result._id, "abc123");
    assert.equal(result.bloomsLevel, "understand");
    assert.equal(result.occurrenceCount, 3);
    assert.deepEqual(result.topics, ["Trees"]);
    assert.deepEqual(result.tags, ["rbtree"]);
    assert.equal(result.hasSimilarQuestions, true);
  });

  it("supplies firstSeenAt/lastSeenAt so the UI does not render Invalid Date", () => {
    const result = promptToUniqueQuestion(prompt);
    assert.equal(result.firstSeenAt, "2024-05-01T10:00:00.000Z");
    assert.equal(result.lastSeenAt, "2024-05-01T10:00:00.000Z");
  });

  it("defaults the occurrence count to 1", () => {
    assert.equal(promptToUniqueQuestion({ questionText: "q" }).occurrenceCount, 1);
    assert.equal(
      promptToUniqueQuestion({ questionText: "q", appearanceFrequency: { count: 0 } }).occurrenceCount,
      1
    );
  });

  it("tolerates prompts with missing fields", () => {
    const result = promptToUniqueQuestion({});
    assert.equal(result.questionText, "");
    assert.deepEqual(result.topics, []);
    assert.deepEqual(result.appearances, []);
    assert.equal(result.bloomsLevel, "understand");
  });
});

describe("queryPrompts", () => {
  const prompts: PromptLike[] = [
    { _id: "1", questionText: "Define a stack", bloomLevel: "Recall", appearanceFrequency: { count: 1 } },
    { _id: "2", questionText: "Compare stack and queue", bloomLevel: "Recall", appearanceFrequency: { count: 5 } },
    {
      _id: "3",
      questionText: "Design a hash table",
      bloomLevel: "Apply",
      appearanceFrequency: { count: 2 },
    },
  ];

  it("matches the UI's lowercase bloom filter against capitalised prompt values", () => {
    const result = queryPrompts(prompts, { bloomsLevel: "remember" });
    assert.deepEqual(
      result.map((p) => p._id),
      ["1", "2"]
    );
  });

  it("matches the capitalised spelling too", () => {
    assert.equal(queryPrompts(prompts, { bloomsLevel: "Apply" }).length, 1);
  });

  it("ignores an unrecognised bloom filter instead of dropping everything", () => {
    assert.equal(queryPrompts(prompts, { bloomsLevel: "nonsense" }).length, 3);
  });

  it("applies minOccurrence", () => {
    assert.equal(queryPrompts(prompts, { minOccurrence: 2 }).length, 2);
  });

  it("searches question text case-insensitively", () => {
    assert.deepEqual(
      queryPrompts(prompts, { search: "STACK" }).map((p) => p._id),
      ["1", "2"]
    );
  });

  it("combines bloom, minOccurrence and search", () => {
    assert.deepEqual(
      queryPrompts(prompts, { bloomsLevel: "remember", minOccurrence: 2, search: "compare" }).map(
        (p) => p._id
      ),
      ["2"]
    );
  });

  it("sorts by occurrence count", () => {
    assert.deepEqual(
      queryPrompts(prompts, { sortBy: "occurrenceCount", sortOrder: "asc" }).map((p) => p._id),
      ["1", "3", "2"]
    );
    assert.deepEqual(
      queryPrompts(prompts, { sortBy: "occurrenceCount", sortOrder: "desc" }).map((p) => p._id),
      ["2", "3", "1"]
    );
  });
});

describe("buildPromptStats", () => {
  it("derives averages from appearanceFrequency.count instead of hard coding 1", () => {
    const stats = buildPromptStats([
      { questionText: "a", appearanceFrequency: { count: 4 } },
      { questionText: "b", appearanceFrequency: { count: 2 } },
      { questionText: "c" },
    ]);

    assert.equal(stats.totalUniqueQuestions, 3);
    assert.equal(stats.totalOccurrences, 7);
    assert.equal(stats.avgOccurrence, 2.3);
  });

  it("uses the lowercase bloom key so it matches the database path", () => {
    const stats = buildPromptStats([
      { questionText: "a", bloomLevel: "Recall" },
      { questionText: "b", bloomsLevel: "understand" },
      { questionText: "c" },
    ]);

    assert.equal(stats.bloomsDistribution.remember, 1);
    assert.equal(stats.bloomsDistribution.understand, 1);
    assert.equal(stats.bloomsDistribution.unknown, 1);
  });

  it("counts prompts that have similar questions", () => {
    const stats = buildPromptStats([
      { questionText: "a", hasSimilarQuestions: true },
      { questionText: "b" },
    ]);
    assert.equal(stats.withSimilarQuestions, 1);
  });

  it("returns zeros for no prompts", () => {
    assert.deepEqual(buildPromptStats([]), {
      totalUniqueQuestions: 0,
      totalOccurrences: 0,
      avgOccurrence: 0,
      bloomsDistribution: {},
      withSimilarQuestions: 0,
    });
  });
});

describe("normalizeSubjectCode", () => {
  it("keeps codes that already match the schema", () => {
    assert.equal(normalizeSubjectCode("CS205"), "CS205");
  });

  it("normalises pipeline formats that failed schema validation", () => {
    assert.equal(normalizeSubjectCode("cs 205"), "CS205");
    assert.equal(normalizeSubjectCode("CS-205"), "CS205");
    assert.equal(normalizeSubjectCode("cs_205"), "CS205");
  });

  it("derives letters from the subject name when the code has none", () => {
    assert.equal(normalizeSubjectCode("205", "Operating Systems"), "OS205");
  });

  it("returns null when nothing usable can be derived", () => {
    assert.equal(normalizeSubjectCode("", ""), null);
    assert.equal(normalizeSubjectCode(null, "!!!"), null);
  });
});

describe("normalizeExamType", () => {
  it("maps to the schema enum", () => {
    assert.equal(normalizeExamType("main"), "main");
    assert.equal(normalizeExamType("KT"), "kt");
    assert.equal(normalizeExamType(" kt "), "kt");
  });

  it("falls back to main for values the enum rejects", () => {
    // The old cast let "quiz" through and failed Zod validation downstream.
    assert.equal(normalizeExamType("quiz"), "main");
    assert.equal(normalizeExamType(undefined), "main");
    assert.equal(normalizeExamType(null), "main");
  });
});

describe("normalizeSubjectYear", () => {
  it("maps calendar years onto the FY/SY/TY/LY cycle", () => {
    assert.equal(normalizeSubjectYear("2025"), "FY");
    assert.equal(normalizeSubjectYear("2027"), "TY");
    assert.equal(normalizeSubjectYear("2028"), "LY");
  });

  it("falls back for unknown or missing years", () => {
    assert.equal(normalizeSubjectYear("2029"), "SY");
    assert.equal(normalizeSubjectYear(undefined), "SY");
    assert.equal(normalizeSubjectYear(undefined, "FY"), "FY");
  });
});

describe("buildAutoSubjectDocument", () => {
  it("produces a document that satisfies the subject schema", () => {
    const doc = buildAutoSubjectDocument({
      subjectName: "Data Structures",
      subjectCode: "ds205",
      branch: "CSE",
      year: "2025",
      semester: "3",
      jobId: "job-1",
    });

    assert.ok(doc);
    assert.equal(doc!.code, "DS205");
    assert.match(doc!.code, /^[A-Z]{2}\d{3}$/);
    assert.equal(doc!.year, "FY");
    assert.equal(doc!.semester, "Semester 3");
    // createdBy is required by the schema and was previously missing entirely.
    assert.equal(doc!.createdBy, "ai-pipeline");
  });

  it("returns null when the subject name is missing", () => {
    assert.equal(
      buildAutoSubjectDocument({ subjectName: "  ", subjectCode: "CS205", jobId: "j" }),
      null
    );
  });

  it("returns null when no valid code can be derived", () => {
    assert.equal(buildAutoSubjectDocument({ subjectName: "!!!", subjectCode: "", jobId: "j" }), null);
  });
});

describe("safeDecodeParam", () => {
  it("decodes percent-encoded params", () => {
    assert.equal(safeDecodeParam("Operating%20Systems"), "Operating Systems");
  });

  it("does not throw on names containing a literal percent sign", () => {
    // Double-decoding threw URIError here and blanked the page.
    assert.equal(safeDecodeParam("100% Java"), "100% Java");
  });

  it("handles missing params", () => {
    assert.equal(safeDecodeParam(undefined), "");
    assert.equal(safeDecodeParam(null), "");
    assert.equal(safeDecodeParam(""), "");
  });
});

describe("API payload guards", () => {
  it("rejects error objects passed where a list is expected", () => {
    assert.deepEqual(toUniqueQuestionList({ error: "boom" }), []);
    assert.deepEqual(toUniqueQuestionList(null), []);
    assert.deepEqual(toUniqueQuestionList(undefined), []);
  });

  it("passes arrays through", () => {
    const rows = [{ _id: "1" }];
    assert.equal(toUniqueQuestionList(rows), rows);
  });

  it("rejects error objects passed where stats are expected", () => {
    assert.equal(toUniqueQuestionStats({ error: "boom" }), null);
    assert.equal(toUniqueQuestionStats([]), null);
    assert.equal(toUniqueQuestionStats({}), null);
  });

  it("normalises partial stats", () => {
    const stats = toUniqueQuestionStats({ totalUniqueQuestions: 12 });
    assert.equal(stats?.totalUniqueQuestions, 12);
    assert.equal(stats?.totalOccurrences, 0);
    assert.equal(stats?.avgOccurrence, 0);
    assert.deepEqual(stats?.bloomsDistribution, {});
  });
});