/**
 * GET /api/results must page the history, batch-load exams, and aggregate
 * summary metrics. Empty history stays an empty list; a database failure is
 * still a 5xx (covered with the repository checks spawned below).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildResultRow,
  calculateGradeDistribution,
  calculatePerformanceTrend,
  calculateSubjectPerformance,
  gradeFor,
  scorePercentage,
  shapeAggregatedResultSummary,
  summarizeResults,
  verdictFor,
  type AggregatedResultSummary,
  type ResultRow,
} from "../../packages/frontend/lib/examResults.ts";
import {
  RESULT_DEFAULT_PASSING_PERCENTAGE,
  RESULT_GRADE_CUTOFFS,
  RESULT_SUBJECT_FALLBACK,
  buildUserResultSummaryPipeline,
  deriveStoredResultMetrics,
  emptyUserResultSummary,
  readSummaryAggregate,
  roundPercentage,
} from "../../packages/backend/src/services/resultSummary.ts";
import {
  SUBMISSION_HISTORY_DEFAULT_LIMIT,
  SUBMISSION_HISTORY_MAX_LIMIT,
  clampHistoryLimit,
  decodeHistoryCursor,
  encodeHistoryCursor,
  historyPageFilter,
  isInvalidResultsCursorError,
} from "../../packages/backend/src/services/submissionHistoryPage.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

const EXAM_ID = "507f1f77bcf86cd799439011";

describe("submission history pages", () => {
  it("clamps the page size and rejects a cursor it did not emit", () => {
    assert.equal(clampHistoryLimit(undefined), SUBMISSION_HISTORY_DEFAULT_LIMIT);
    assert.equal(clampHistoryLimit(null), SUBMISSION_HISTORY_DEFAULT_LIMIT);
    assert.equal(clampHistoryLimit("0"), SUBMISSION_HISTORY_DEFAULT_LIMIT);
    assert.equal(clampHistoryLimit("1.5"), SUBMISSION_HISTORY_DEFAULT_LIMIT);
    assert.equal(clampHistoryLimit("7"), 7);
    assert.equal(clampHistoryLimit(String(SUBMISSION_HISTORY_MAX_LIMIT + 40)), SUBMISSION_HISTORY_MAX_LIMIT);

    const cursor = encodeHistoryCursor({
      submittedAt: new Date("2026-03-01T12:00:00.000Z"),
      id: EXAM_ID,
    });
    const decoded = decodeHistoryCursor(cursor);
    assert.equal(decoded.id, EXAM_ID);
    assert.equal(decoded.submittedAt.toISOString(), "2026-03-01T12:00:00.000Z");

    const filter = historyPageFilter("user_1", decoded);
    assert.equal(filter.userId, "user_1");
    assert.deepEqual(filter.gradingStatus, { $ne: "pending" });
    assert.deepEqual(filter.$or, [
      { submittedAt: { $lt: decoded.submittedAt } },
      { submittedAt: decoded.submittedAt, _id: { $lt: EXAM_ID } },
    ]);
    assert.deepEqual(historyPageFilter("user_1", null), {
      userId: "user_1",
      gradingStatus: { $ne: "pending" },
    });

    for (const bad of [
      "not-a-cursor",
      Buffer.from("{}", "utf8").toString("base64url"),
      Buffer.from(JSON.stringify({ t: "2026-03-01", id: EXAM_ID }), "utf8").toString("base64url"),
      Buffer.from(JSON.stringify({ t: "2026-03-01T12:00:00.000Z", id: "nope" }), "utf8").toString("base64url"),
    ]) {
      assert.throws(() => decodeHistoryCursor(bad), isInvalidResultsCursorError);
    }
  });
});

describe("result summary aggregation", () => {
  it("rounds non-negative percentages the way the aggregation's $floor(raw + 0.5) does", () => {
    for (let value = 0; value <= 120; value += 0.25) {
      assert.equal(Math.floor(value + 0.5), Math.round(value), String(value));
      assert.equal(roundPercentage(value), Math.round(value));
    }
  });

  it("matches the row derivations used by the results list", () => {
    const samples = [
      {
        marksAchieved: 9,
        maxMarks: 10,
        passingPercentage: 40,
        subject: "OS",
        submittedAt: "2026-01-15T00:00:00.000Z",
      },
      {
        marksAchieved: 1,
        maxMarks: 8,
        passingPercentage: 40,
        subject: "Maths",
        submittedAt: "2026-03-02T00:00:00.000Z",
      },
      {
        marksAchieved: 5,
        maxMarks: 0,
        passingPercentage: undefined,
        subject: "   ",
        submittedAt: "not-a-date",
      },
      {
        marksAchieved: 55,
        maxMarks: 100,
        passingPercentage: "60",
        subject: "Physics",
        submittedAt: "2026-06-20T00:00:00.000Z",
      },
      {
        marksAchieved: 2,
        maxMarks: 10,
        passingPercentage: 40,
        subject: "OS",
        submittedAt: "2025-11-01T00:00:00.000Z",
      },
    ];

    const rows = samples.map((sample, index) =>
      buildResultRow(
        {
          _id: `sub-${index}`,
          examId: "exam",
          submittedAt: sample.submittedAt,
          marksAchieved: sample.marksAchieved,
          maxMarks: sample.maxMarks,
        },
        sample.subject === "   "
          ? null
          : { subject: sample.subject, passingPercentage: sample.passingPercentage, examTitle: "Exam" },
      ),
    );

    samples.forEach((sample, index) => {
      const metrics = deriveStoredResultMetrics(
        sample.subject === "   "
          ? {
              marksAchieved: sample.marksAchieved,
              maxMarks: sample.maxMarks,
              submittedAt: sample.submittedAt,
            }
          : sample,
      );
      assert.equal(metrics.roundedPercentage, rows[index].percentage);
      assert.equal(metrics.grade, rows[index].grade);
      assert.equal(metrics.passed, rows[index].status === "passed");
      assert.equal(metrics.subject, rows[index].subject);
      assert.equal(metrics.roundedPercentage, roundPercentage(scorePercentage(sample.marksAchieved, sample.maxMarks)));
      assert.equal(metrics.grade, gradeFor(scorePercentage(sample.marksAchieved, sample.maxMarks)));
      assert.equal(
        metrics.passed,
        verdictFor(
          scorePercentage(sample.marksAchieved, sample.maxMarks),
          sample.subject === "   " ? RESULT_DEFAULT_PASSING_PERCENTAGE : sample.passingPercentage,
        ) === "passed",
      );
    });

    assert.equal(rows[2].subject, RESULT_SUBJECT_FALLBACK);
    assert.deepEqual(shapeAggregatedResultSummary(bucketsFrom(rows)), chartsFrom(rows));
  });

  it("turns an empty facet into the same zeroes as an empty result list", () => {
    assert.deepEqual(readSummaryAggregate([]), emptyUserResultSummary());
    assert.deepEqual(readSummaryAggregate([{ stats: [], grades: [], subjects: [], months: [] }]), emptyUserResultSummary());
    const shaped = shapeAggregatedResultSummary(emptyUserResultSummary());
    assert.deepEqual(shaped.stats, summarizeResults([]));
    assert.deepEqual(shaped.performanceData, []);
    assert.deepEqual(shaped.subjectPerformance, []);
    assert.deepEqual(shaped.gradeDistribution, []);
  });

  it("builds one lookup and one facet, with no page limit on the totals", () => {
    const pipeline = buildUserResultSummaryPipeline(
      { userId: "user_1", gradingStatus: { $ne: "pending" } },
      "examsets",
    );
    const serialized = JSON.stringify(pipeline);

    assert.deepEqual(pipeline[0], {
      $match: { userId: "user_1", gradingStatus: { $ne: "pending" } },
    });
    assert.match(serialized, /"\$lookup"/);
    assert.match(serialized, /"from":"examsets"/);
    assert.match(serialized, /"\$facet"/);
    assert.match(serialized, /"\$group"/);
    assert.doesNotMatch(serialized, /"\$limit"/);
    assert.equal(serialized.includes("deletedAt"), false);
    for (const [cutoff, grade] of RESULT_GRADE_CUTOFFS) {
      assert.equal(serialized.includes(String(cutoff)), true, String(cutoff));
      assert.equal(serialized.includes(grade), true, grade);
    }
    assert.equal(serialized.includes(RESULT_SUBJECT_FALLBACK), true);
    assert.equal(serialized.includes(String(RESULT_DEFAULT_PASSING_PERCENTAGE)), true);
  });
});

describe("results API and page", () => {
  it("pages history, batch-loads exams, and aggregates totals", () => {
    const route = read("packages/frontend/app/api/results/route.ts");

    assert.match(route, /submissionRepo\.getByUser\(\s*userId/);
    assert.match(route, /clampHistoryLimit/);
    assert.match(route, /examRepo\.getHistoricalByIds/);
    assert.match(route, /submissionRepo\.summarizeByUser/);
    assert.match(route, /shapeAggregatedResultSummary/);
    assert.match(route, /status:\s*400/);
    assert.match(route, /status:\s*404/);
    assert.match(route, /status:\s*500/);
    assert.doesNotMatch(route, /examRepo\.getById/);
    assert.doesNotMatch(route, /\.map\(\s*async/);
    assert.doesNotMatch(route, /\|\|\s*\[\]/);
  });

  it("paginates the results page and still exports the loaded rows", () => {
    const page = read("packages/frontend/app/results/page.tsx");

    assert.match(page, /\/api\/results\?\$\{params\.toString\(\)\}/);
    assert.match(page, /limit: String\(RESULTS_PAGE_SIZE\)/);
    assert.match(page, /params\.set\("cursor", cursor\)/);
    assert.match(page, /goToNextPage/);
    assert.match(page, /goToPreviousPage/);
    assert.match(page, />\s*Next\s*</);
    assert.match(page, />\s*Previous\s*</);
    assert.match(page, /resultsDownload\(filteredResults, "exam-results\.csv"\)/);
    assert.match(page, /resultCsvFileName\(result\.examName\)/);
    assert.doesNotMatch(page, /fetch\("\/api\/results"\)/);
  });

  it("propagates a failed history read and keeps an empty page empty", () => {
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
      if (key.startsWith("NODE_TEST") || key.startsWith("NODE_CHANNEL")) delete env[key];
    }
    env.mongodb_url = process.env.mongodb_url || "mongodb://127.0.0.1:27017/eesa-results-history-test";

    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "--test", "tests/node/results-history.check.ts"],
      { cwd: root, encoding: "utf8", env },
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /returns the next cursor from the last row on the page/);
    assert.match(result.stdout, /# fail 0/);
  });
});

function bucketsFrom(rows: ResultRow[]): AggregatedResultSummary {
  const metrics = rows.map((row) =>
    deriveStoredResultMetrics({
      marksAchieved: row.score,
      maxMarks: row.totalMarks,
      passingPercentage: row.passingPercentage,
      subject: row.subject,
      submittedAt: row.date,
    }),
  );
  const grades = new Map<string, number>();
  const subjects = new Map<string, { total: number; count: number }>();
  const months = new Map<string, { total: number; count: number }>();

  for (const metric of metrics) {
    grades.set(metric.grade, (grades.get(metric.grade) ?? 0) + 1);
    const subject = subjects.get(metric.subject) ?? { total: 0, count: 0 };
    subject.total += metric.roundedPercentage;
    subject.count += 1;
    subjects.set(metric.subject, subject);
    if (metric.monthKey) {
      const month = months.get(metric.monthKey) ?? { total: 0, count: 0 };
      month.total += metric.roundedPercentage;
      month.count += 1;
      months.set(metric.monthKey, month);
    }
  }

  return {
    totalExams: metrics.length,
    passedExams: metrics.filter((metric) => metric.passed).length,
    roundedScoreSum: metrics.reduce((sum, metric) => sum + metric.roundedPercentage, 0),
    highestScore:
      metrics.length === 0 ? 0 : Math.max(...metrics.map((metric) => metric.roundedPercentage)),
    grades: Array.from(grades, ([grade, count]) => ({ grade, count })),
    subjects: Array.from(subjects, ([subject, bucket]) => ({ subject, ...bucket })),
    months: Array.from(months, ([key, bucket]) => ({ key, ...bucket })),
  };
}

function chartsFrom(rows: ResultRow[]) {
  return {
    stats: summarizeResults(rows),
    performanceData: calculatePerformanceTrend(rows),
    subjectPerformance: calculateSubjectPerformance(rows),
    gradeDistribution: calculateGradeDistribution(rows),
  };
}
