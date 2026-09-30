import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_EXAM_DURATION_MINUTES,
  DEFAULT_PASSING_PERCENTAGE,
  buildResultRow,
  calculateGradeDistribution,
  calculatePerformanceTrend,
  calculateSubjectPerformance,
  duplicateSubmissionOutcome,
  examTimeLimitSeconds,
  formatDuration,
  gradeFor,
  isWithinDateWindow,
  resolvePassingPercentage,
  resolveSubmissionTime,
  scorePercentage,
  sortResultsByDateDesc,
  summarizeResults,
  verdictFor,
  type ResultRow,
} from "../../packages/frontend/lib/examResults.ts";

const row = (overrides: Partial<ResultRow> = {}): ResultRow =>
  buildResultRow(
    {
      _id: "sub1",
      examId: "exam1",
      submittedAt: "2026-03-10T12:00:00.000Z",
      marksAchieved: 8,
      maxMarks: 10,
      timeSpent: 300,
      ...overrides,
    } as never,
    overrides.examId === undefined
      ? { examTitle: "OS Final", subject: "Operating Systems", examDegree: "B.Tech", passingPercentage: 50 }
      : undefined,
  );

describe("scorePercentage", () => {
  it("computes the percentage", () => {
    assert.equal(scorePercentage(8, 10), 80);
  });

  it("returns 0 instead of Infinity when maxMarks is 0", () => {
    assert.equal(scorePercentage(5, 0), 0);
  });

  it("returns 0 instead of NaN when maxMarks is missing or unusable", () => {
    assert.equal(scorePercentage(5, undefined), 0);
    assert.equal(scorePercentage(5, "not a number"), 0);
    assert.equal(scorePercentage(5, Number.NaN), 0);
    assert.equal(scorePercentage(5, -10), 0);
  });
});

describe("resolvePassingPercentage", () => {
  it("uses the exam's own threshold", () => {
    assert.equal(resolvePassingPercentage({ passingPercentage: 35 }), 35);
  });

  it("clamps out-of-range thresholds", () => {
    assert.equal(resolvePassingPercentage({ passingPercentage: -10 }), 0);
    assert.equal(resolvePassingPercentage({ passingPercentage: 140 }), 100);
  });

  it("falls back only for a missing or unusable threshold", () => {
    assert.equal(resolvePassingPercentage({}), DEFAULT_PASSING_PERCENTAGE);
    assert.equal(resolvePassingPercentage(null), DEFAULT_PASSING_PERCENTAGE);
    assert.equal(resolvePassingPercentage({ passingPercentage: "abc" }), DEFAULT_PASSING_PERCENTAGE);
  });

  it("keeps 0 as a real threshold", () => {
    assert.equal(resolvePassingPercentage({ passingPercentage: 0 }), 0);
  });
});

describe("verdictFor", () => {
  it("passes at the threshold and fails one point below it", () => {
    assert.equal(verdictFor(35, 35), "passed");
    assert.equal(verdictFor(34.9, 35), "failed");
  });

  it("no longer disagrees between the list page and the detail page", () => {
    // /api/results used a literal 40 and /results/[id] a literal 60, so a 45%
    // submission was "passed" in one place and "failed" in the other.
    const passing = resolvePassingPercentage({ passingPercentage: 45 });
    const detailVerdict = scorePercentage(45, 100) >= passing ? "Passed" : "Failed";
    assert.equal(detailVerdict, "Passed");
    assert.equal(verdictFor(45, passing), "passed");
  });
});

describe("gradeFor", () => {
  it("maps the documented cut-offs", () => {
    assert.equal(gradeFor(100), "A+");
    assert.equal(gradeFor(90), "A+");
    assert.equal(gradeFor(85), "A");
    assert.equal(gradeFor(75), "B+");
    assert.equal(gradeFor(65), "B");
    assert.equal(gradeFor(55), "C+");
    assert.equal(gradeFor(45), "C");
    assert.equal(gradeFor(39), "F");
    assert.equal(gradeFor(0), "F");
  });
});

describe("formatDuration", () => {
  it("formats minutes and hours", () => {
    assert.equal(formatDuration(300), "5 minutes");
    assert.equal(formatDuration(3900), "1h 5m");
    assert.equal(formatDuration(3600), "1h");
  });

  it("reports N/A instead of NaN for an unusable duration", () => {
    assert.equal(formatDuration("abc"), "N/A");
    assert.equal(formatDuration(undefined), "N/A");
    assert.equal(formatDuration(-1), "N/A");
    assert.equal(formatDuration(0), "N/A");
  });
});

describe("buildResultRow", () => {
  it("reads the subject, not the degree programme", () => {
    const built = row();
    assert.equal(built.subject, "Operating Systems");
    assert.equal(built.examName, "OS Final");
  });

  it("falls back to General when the exam has no subject", () => {
    const built = buildResultRow(
      { _id: "s", examId: "e", marksAchieved: 1, maxMarks: 2 },
      { examTitle: "T", examDegree: "B.Tech" },
    );
    assert.equal(built.subject, "General");
  });

  it("verdicts against the exam threshold, not a constant", () => {
    const passed = buildResultRow(
      { _id: "s", examId: "e", marksAchieved: 45, maxMarks: 100 },
      { passingPercentage: 40 },
    );
    const failed = buildResultRow(
      { _id: "s", examId: "e", marksAchieved: 45, maxMarks: 100 },
      { passingPercentage: 60 },
    );
    assert.equal(passed.status, "passed");
    assert.equal(failed.status, "failed");
    assert.equal(passed.grade, failed.grade);
  });

  it("survives a submission with no marks at all", () => {
    const built = buildResultRow({ _id: "s", examId: "e" }, null);
    assert.equal(built.percentage, 0);
    assert.equal(built.grade, "F");
    assert.equal(built.status, "failed");
    assert.equal(built.duration, "N/A");
    assert.equal(built.responsesCount, 0);
  });

  it("marks auto-submitted only for a literal true", () => {
    assert.equal(buildResultRow({ _id: "s", examId: "e", autoSubmitted: true }).autoSubmitted, true);
    assert.equal(buildResultRow({ _id: "s", examId: "e", autoSubmitted: "yes" }).autoSubmitted, false);
  });
});

describe("summarizeResults", () => {
  it("returns zeroes for no results", () => {
    assert.deepEqual(summarizeResults([]), {
      totalExams: 0,
      passedExams: 0,
      failedExams: 0,
      avgScore: 0,
      highestScore: 0,
      passRate: 0,
    });
  });

  it("counts verdicts per exam", () => {
    const rows = [
      buildResultRow({ _id: "1", examId: "e", marksAchieved: 9, maxMarks: 10 }, { passingPercentage: 40 }),
      buildResultRow({ _id: "2", examId: "e", marksAchieved: 5, maxMarks: 10 }, { passingPercentage: 40 }),
      buildResultRow({ _id: "3", examId: "e", marksAchieved: 2, maxMarks: 10 }, { passingPercentage: 40 }),
    ];
    const stats = summarizeResults(rows);
    assert.equal(stats.totalExams, 3);
    // 90% and 50% clear the 40% threshold, 20% does not.
    assert.equal(stats.passedExams, 2);
    assert.equal(stats.failedExams, 1);
    assert.equal(stats.highestScore, 90);
    assert.equal(stats.avgScore, Math.round((90 + 50 + 20) / 3));
    assert.equal(stats.passRate, 67);
  });
});

describe("sortResultsByDateDesc", () => {
  it("orders newest first and keeps undated rows last", () => {
    const rows = [
      buildResultRow({ _id: "old", examId: "e", submittedAt: "2025-01-05T00:00:00.000Z" }),
      buildResultRow({ _id: "new", examId: "e", submittedAt: "2026-06-05T00:00:00.000Z" }),
      buildResultRow({ _id: "bad", examId: "e", submittedAt: "not a date" }),
    ];
    assert.deepEqual(
      sortResultsByDateDesc(rows).map((r) => r.id),
      ["new", "old", "bad"],
    );
  });
});

describe("calculatePerformanceTrend", () => {
  const at = (id: string, iso: string, percentage: number) =>
    buildResultRow({ _id: id, examId: "e", submittedAt: iso, marksAchieved: percentage, maxMarks: 100 });

  it("returns the most recent months, oldest first", () => {
    const rows = [
      at("1", "2026-01-15T00:00:00.000Z", 10),
      at("2", "2026-02-15T00:00:00.000Z", 20),
      at("3", "2026-03-15T00:00:00.000Z", 30),
      at("4", "2026-04-15T00:00:00.000Z", 40),
      at("5", "2026-05-15T00:00:00.000Z", 50),
      at("6", "2026-06-15T00:00:00.000Z", 60),
    ];
    const trend = calculatePerformanceTrend(rows, 5);
    assert.equal(trend.length, 5);
    // The old implementation took the five *oldest* months.
    assert.deepEqual(
      trend.map((point) => point.key),
      ["2026-02", "2026-03", "2026-04", "2026-05", "2026-06"],
    );
  });

  it("does not merge the same month across different years", () => {
    const rows = [
      at("1", "2025-01-10T00:00:00.000Z", 100),
      at("2", "2026-01-10T00:00:00.000Z", 20),
    ];
    const trend = calculatePerformanceTrend(rows, 5);
    assert.equal(trend.length, 2);
    assert.deepEqual(
      trend.map((point) => [point.key, point.score]),
      [
        ["2025-01", 100],
        ["2026-01", 20],
      ],
    );
  });

  it("averages the submissions inside a month", () => {
    const rows = [
      at("1", "2026-03-01T00:00:00.000Z", 100),
      at("2", "2026-03-20T00:00:00.000Z", 60),
    ];
    const trend = calculatePerformanceTrend(rows, 5);
    assert.equal(trend.length, 1);
    assert.equal(trend[0].score, 80);
    assert.equal(trend[0].count, 2);
  });

  it("skips undated rows instead of producing a NaN bucket", () => {
    const rows = [buildResultRow({ _id: "bad", examId: "e", submittedAt: "nope" })];
    assert.deepEqual(calculatePerformanceTrend(rows), []);
  });
});

describe("calculateSubjectPerformance", () => {
  it("averages per subject and orders best first", () => {
    const rows = [
      buildResultRow({ _id: "1", examId: "e", marksAchieved: 30, maxMarks: 100 }, { subject: "Maths" }),
      buildResultRow({ _id: "2", examId: "e", marksAchieved: 90, maxMarks: 100 }, { subject: "OS" }),
      buildResultRow({ _id: "3", examId: "e", marksAchieved: 70, maxMarks: 100 }, { subject: "OS" }),
    ];
    const performance = calculateSubjectPerformance(rows);
    assert.deepEqual(
      performance.map((entry) => [entry.subject, entry.score]),
      [
        ["OS", 80],
        ["Maths", 30],
      ],
    );
    assert.notEqual(performance[0].color, performance[1].color);
  });
});

describe("calculateGradeDistribution", () => {
  it("counts each grade and orders A+ first", () => {
    const rows = [
      buildResultRow({ _id: "1", examId: "e", marksAchieved: 10, maxMarks: 10 }),
      buildResultRow({ _id: "2", examId: "e", marksAchieved: 9, maxMarks: 10 }),
      buildResultRow({ _id: "3", examId: "e", marksAchieved: 0, maxMarks: 10 }),
    ];
    // 100% and 90% are both A+; there is no A bucket in this set.
    assert.deepEqual(
      calculateGradeDistribution(rows).map((entry) => [entry.grade, entry.count]),
      [
        ["A+", 2],
        ["F", 1],
      ],
    );
  });

  it("orders a mixed set from A+ down to F", () => {
    const rows = [95, 85, 75, 65, 55, 45, 10].map((score, index) =>
      buildResultRow({ _id: String(index), examId: "e", marksAchieved: score, maxMarks: 100 }),
    );
    assert.deepEqual(
      calculateGradeDistribution(rows).map((entry) => entry.grade),
      ["A+", "A", "B+", "B", "C+", "C", "F"],
    );
  });
});

describe("isWithinDateWindow", () => {
  const now = new Date("2026-06-15T12:00:00.000Z");

  it("always accepts the all-time filter", () => {
    assert.equal(isWithinDateWindow("1999-01-01T00:00:00.000Z", "all", now), true);
  });

  it("measures the window backwards only", () => {
    assert.equal(isWithinDateWindow("2026-06-14T12:00:00.000Z", "week", now), true);
    assert.equal(isWithinDateWindow("2026-06-01T12:00:00.000Z", "week", now), false);
    assert.equal(isWithinDateWindow("2026-05-20T12:00:00.000Z", "month", now), true);
    // 106 days back is inside the 120-day semester window, 165 is not.
    assert.equal(isWithinDateWindow("2026-03-01T12:00:00.000Z", "semester", now), true);
    assert.equal(isWithinDateWindow("2026-01-01T12:00:00.000Z", "semester", now), false);
  });

  it("never matches a submission dated in the future", () => {
    // The old check used Math.abs, so a pre-dated or clock-skewed record was
    // reported as "last week".
    for (const filter of ["week", "month", "semester"] as const) {
      assert.equal(isWithinDateWindow("2026-07-01T00:00:00.000Z", filter, now), false);
    }
  });

  it("rejects an unparseable date", () => {
    assert.equal(isWithinDateWindow("nope", "week", now), false);
  });
});

describe("examTimeLimitSeconds", () => {
  it("converts the exam duration", () => {
    assert.equal(examTimeLimitSeconds(45), 2700);
  });

  it("falls back for a missing, zero or unusable duration", () => {
    assert.equal(examTimeLimitSeconds(undefined), DEFAULT_EXAM_DURATION_MINUTES * 60);
    assert.equal(examTimeLimitSeconds(0), DEFAULT_EXAM_DURATION_MINUTES * 60);
    assert.equal(examTimeLimitSeconds("abc"), DEFAULT_EXAM_DURATION_MINUTES * 60);
  });
});

describe("resolveSubmissionTime", () => {
  it("keeps a duration inside the exam window", () => {
    assert.deepEqual(resolveSubmissionTime({ durationMinutes: 30, timeSpent: 120 }), {
      timeSpent: 120,
      autoSubmitted: false,
    });
  });

  it("clamps a duration beyond the exam window", () => {
    assert.deepEqual(resolveSubmissionTime({ durationMinutes: 30, timeSpent: 99_999 }), {
      timeSpent: 1800,
      autoSubmitted: true,
    });
  });

  it("marks an attempt that used the whole window as auto-submitted", () => {
    assert.deepEqual(resolveSubmissionTime({ durationMinutes: 30, timeSpent: 1800, autoSubmit: false }), {
      timeSpent: 1800,
      autoSubmitted: true,
    });
  });

  it("honours an auto-submit claim from the countdown", () => {
    assert.deepEqual(resolveSubmissionTime({ durationMinutes: 30, timeSpent: 10, autoSubmit: true }), {
      timeSpent: 10,
      autoSubmitted: true,
    });
  });

  it("rejects a non-numeric or negative duration", () => {
    assert.deepEqual(resolveSubmissionTime({ durationMinutes: 30, timeSpent: "abc" }), {
      error: "timeSpent must be a number of seconds",
    });
    assert.deepEqual(resolveSubmissionTime({ durationMinutes: 30, timeSpent: -1 }), {
      error: "timeSpent cannot be negative",
    });
    assert.deepEqual(resolveSubmissionTime({ durationMinutes: 30, timeSpent: Number.NaN }), {
      error: "timeSpent must be a number of seconds",
    });
  });

  it("truncates fractional seconds", () => {
    assert.deepEqual(resolveSubmissionTime({ durationMinutes: 30, timeSpent: 12.9 }), {
      timeSpent: 12,
      autoSubmitted: false,
    });
  });
});

describe("duplicateSubmissionOutcome", () => {
  it("is a 409 carrying the existing submission id", () => {
    // The route used to grade first and then answer 500 with no id at all.
    assert.deepEqual(duplicateSubmissionOutcome({ _id: "abc123" }), {
      status: 409,
      error: "You have already submitted this exam",
      submissionId: "abc123",
    });
  });

  it("omits the id when the existing record has none", () => {
    assert.deepEqual(duplicateSubmissionOutcome(null), {
      status: 409,
      error: "You have already submitted this exam",
    });
  });
});
