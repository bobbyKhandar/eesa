/**
 * The single-analysis "compare with past papers" option must report a Bloom
 * distribution comparison against the same user's earlier analyses, or say
 * that none exist. It must not claim topic coverage or similar questions.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  compareBloomWithEarlierAnalyses,
  pastPaperComparisonBadge,
} from "../../../packages/frontend/lib/pastPaperComparison.ts";

const ANALYZE_PAGE = "packages/frontend/app/ai-analyze/page.tsx";
const UPLOAD_ROUTE = "packages/frontend/app/api/exam-analysis/upload/route.ts";
const REPORT_PAGE = "packages/frontend/app/analysis-report/[id]/page.tsx";

const EVEN = {
  Recall: 0,
  Understand: 0,
  Apply: 0,
  Analyze: 0,
  Evaluate: 0,
  Create: 0,
};

function distribution(overrides: Record<string, number>) {
  return { ...EVEN, ...overrides };
}

describe("compareBloomWithEarlierAnalyses", () => {
  it("reports that nothing was compared when the subject has no earlier analysis", () => {
    const result = compareBloomWithEarlierAnalyses({
      currentId: "current",
      subjectName: "Physics",
      bloomDistribution: distribution({ Recall: 100 }),
      earlierAnalyses: [
        {
          id: "other-subject",
          subjectName: "Chemistry",
          year: "2022",
          status: "completed",
          totalQuestions: 4,
          bloomDistribution: distribution({ Apply: 100 }),
        },
        {
          id: "current",
          subjectName: "Physics",
          year: "2024",
          status: "completed",
          totalQuestions: 4,
          bloomDistribution: distribution({ Apply: 100 }),
        },
        {
          id: "empty",
          subjectName: "Physics",
          year: "2021",
          status: "completed",
          totalQuestions: 0,
          bloomDistribution: distribution({ Apply: 100 }),
        },
        {
          id: "pending",
          subjectName: "Physics",
          year: "2020",
          status: "pending",
          totalQuestions: 3,
          bloomDistribution: distribution({ Apply: 100 }),
        },
      ],
    });

    assert.equal(result.pastPaperComparison.status, "No earlier analyses");
    assert.equal(
      result.pastPaperComparison.detail,
      "No earlier completed analysis of this subject was found.",
    );
    assert.equal(result.pastPaperComparison.tone, "neutral");
    assert.deepEqual(result.pastPaperComparison.trends, []);
    assert.equal(Object.hasOwn(result.pastPaperComparison, "deviation"), false);
    assert.deepEqual(result.comparedAnalysisIds, []);
    assert.equal(
      pastPaperComparisonBadge(result.pastPaperComparison.deviation),
      "No history",
    );
  });

  it("matches the subject ignoring case and surrounding spaces and averages earlier papers", () => {
    const result = compareBloomWithEarlierAnalyses({
      currentId: "current",
      subjectName: " Physics ",
      bloomDistribution: distribution({ Recall: 30, Understand: 70 }),
      earlierAnalyses: [
        {
          id: "paper-2024",
          subjectName: "physics",
          year: "2024",
          status: "published",
          totalQuestions: 8,
          bloomDistribution: distribution({ Recall: 40, Understand: 60 }),
        },
        {
          id: "paper-2023",
          subjectName: "PHYSICS",
          year: "2023",
          status: "completed",
          totalQuestions: 5,
          bloomDistribution: distribution({ Recall: 20, Understand: 80 }),
        },
        {
          id: "failed",
          subjectName: "Physics",
          year: "2019",
          status: "failed",
          totalQuestions: 5,
          bloomDistribution: distribution({ Create: 100 }),
        },
      ],
    });

    assert.deepEqual(result.comparedAnalysisIds, ["paper-2024", "paper-2023"]);
    assert.equal(result.pastPaperComparison.deviation, 0);
    assert.equal(result.pastPaperComparison.tone, "success");
    assert.equal(
      result.pastPaperComparison.status,
      "Close to earlier analyses",
    );
    assert.match(
      result.pastPaperComparison.detail,
      /Compared with 2 earlier completed analyses of this subject \(2023, 2024\)/,
    );
    assert.match(
      result.pastPaperComparison.detail,
      /Largest shift is Recall: 30% on this exam and 30% on those analyses/,
    );
    assert.equal(
      pastPaperComparisonBadge(result.pastPaperComparison.deviation),
      "0 pp",
    );
  });

  it("reports the largest Bloom shift and lists levels that moved by at least 5 points", () => {
    const result = compareBloomWithEarlierAnalyses({
      currentId: "current",
      subjectName: "Physics",
      bloomDistribution: distribution({ Recall: 50, Apply: 50 }),
      earlierAnalyses: [
        {
          id: "prior",
          subjectName: "Physics",
          year: "2022",
          status: "completed",
          totalQuestions: 2,
          bloomDistribution: distribution({ Recall: 20, Apply: 80 }),
        },
      ],
    });

    assert.deepEqual(result.comparedAnalysisIds, ["prior"]);
    assert.equal(result.pastPaperComparison.deviation, 30);
    assert.equal(result.pastPaperComparison.tone, "error");
    assert.equal(
      result.pastPaperComparison.status,
      "Large difference from earlier analyses",
    );
    assert.match(
      result.pastPaperComparison.detail,
      /1 earlier completed analysis of this subject \(2022\)/,
    );
    assert.match(result.pastPaperComparison.detail, /Largest shift is Recall/);
    assert.deepEqual(result.pastPaperComparison.trends, [
      "Recall is 50% on this exam and 20% on earlier analyses.",
      "Apply is 50% on this exam and 80% on earlier analyses.",
    ]);
    assert.equal(pastPaperComparisonBadge(30), "30 pp");
  });

  it("uses a warning tone when the largest shift is at least 10 and below 25 points", () => {
    const result = compareBloomWithEarlierAnalyses({
      currentId: "current",
      subjectName: "Physics",
      bloomDistribution: distribution({ Recall: 50, Understand: 50 }),
      earlierAnalyses: [
        {
          id: "prior",
          subjectName: "Physics",
          year: "2021",
          status: "completed",
          totalQuestions: 2,
          bloomDistribution: distribution({ Recall: 35, Understand: 65 }),
        },
      ],
    });

    assert.equal(result.pastPaperComparison.deviation, 15);
    assert.equal(result.pastPaperComparison.tone, "warning");
    assert.equal(
      result.pastPaperComparison.status,
      "Some difference from earlier analyses",
    );
  });

  it("does not mention topics, syllabus alignment, or similar questions", () => {
    const result = compareBloomWithEarlierAnalyses({
      currentId: "current",
      subjectName: "Physics",
      bloomDistribution: distribution({ Recall: 100 }),
      earlierAnalyses: [
        {
          id: "prior",
          subjectName: "Physics",
          year: "2020",
          status: "completed",
          totalQuestions: 1,
          bloomDistribution: distribution({ Create: 100 }),
        },
      ],
    });

    const text = [
      result.pastPaperComparison.status,
      result.pastPaperComparison.detail,
      ...result.pastPaperComparison.trends,
    ].join(" ");

    assert.doesNotMatch(text, /topic/i);
    assert.doesNotMatch(text, /syllabus/i);
    assert.doesNotMatch(text, /similar question/i);
  });
});

describe("single analysis past-paper option", () => {
  it("describes a Bloom comparison with earlier analyses and still submits the flag", () => {
    const page = readFileSync(ANALYZE_PAGE, "utf8");

    assert.match(page, /comparePastPapers/);
    assert.match(
      page,
      /compareBloomWithEarlierAnalyses|Compare with earlier analyses/,
    );
    assert.doesNotMatch(page, /topic coverage/i);
    assert.doesNotMatch(page, /historical distribution/i);
  });

  it("computes the comparison from the same user's stored analyses while processing", () => {
    const route = readFileSync(UPLOAD_ROUTE, "utf8");

    assert.match(route, /compareBloomWithEarlierAnalyses\(/);
    assert.match(route, /getByUser\(\s*stored\.analyzedBy\s*\)/);
    assert.match(route, /stored\.analysisOptions\?\.comparePastPapers/);
    assert.match(route, /pastPaperIds:\s*comparison\.comparedAnalysisIds/);
    assert.doesNotMatch(route, /pastPaperIds:\s*\[\]/);
  });

  it("shows the computed shift on the report and keeps the written assessment", () => {
    const page = readFileSync(REPORT_PAGE, "utf8");

    assert.match(page, /pastPaperComparisonBadge\(/);
    assert.doesNotMatch(page, /Aligned/);
    assert.doesNotMatch(
      page,
      /!analysis\.pastPaperComparison && analysis\.overallAssessment/,
    );
    assert.match(page, /analysis\.pastPaperComparison\.trends/);
  });
});
