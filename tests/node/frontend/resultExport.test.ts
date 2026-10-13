/**
 * Results and published-report export/share controls must act on data the
 * page already has: a CSV of the results table, a copied page link, and a
 * text download of the published report.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  copyPageLink,
  reportDownload,
  resultCsvFileName,
  resultsDownload,
  shareButtonLabel,
} from "../../../packages/frontend/lib/resultExport.ts";

const RESULTS_PAGE = "packages/frontend/app/results/page.tsx";
const REPORT_PAGE = "packages/frontend/app/reports/[id]/page.tsx";

const sampleRow = {
  examName: 'Physics, "Honours"',
  subject: "Physics",
  date: "2026-03-15T18:30:00.000Z",
  score: 42,
  totalMarks: 50,
  percentage: 84,
  grade: "A",
  status: "passed" as const,
  duration: "1h 5m",
};

describe("results CSV export", () => {
  it("exports the visible table columns, with spreadsheet-safe quoting", () => {
    const download = resultsDownload([sampleRow], "exam-results.csv");

    assert.equal(download.fileName, "exam-results.csv");
    assert.equal(download.mimeType, "text/csv;charset=utf-8");
    assert.equal(
      download.contents,
      [
        "Exam,Subject,Date,Score,Total Marks,Percentage,Grade,Status,Duration",
        '"Physics, ""Honours""",Physics,2026-03-15,42,50,84,A,passed,1h 5m',
        "",
      ].join("\r\n")
    );
  });

  it("prefixes formula-like exam names so a spreadsheet does not execute them", () => {
    const download = resultsDownload(
      [{ ...sampleRow, examName: "=1+1", subject: "+Physics" }],
      "exam-results.csv"
    );

    assert.match(download.contents, /'=1\+1,'\+Physics,2026-03-15,42,50,84,A,passed,1h 5m/);
  });

  it("emits a header-only file when the table is empty", () => {
    const download = resultsDownload([], "exam-results.csv");

    assert.equal(
      download.contents,
      "Exam,Subject,Date,Score,Total Marks,Percentage,Grade,Status,Duration\r\n"
    );
  });

  it("names a single-row download after the exam", () => {
    assert.equal(resultCsvFileName("Midterm Physics"), "exam-result-midterm-physics.csv");
    assert.equal(resultCsvFileName("  "), "exam-result.csv");
  });

  it("keeps an unparseable date as text instead of dropping the row", () => {
    const download = resultsDownload(
      [{ ...sampleRow, date: "not-a-date" }],
      "exam-results.csv"
    );

    assert.match(download.contents, /,not-a-date,42,50,84,/);
  });
});

describe("copy-link share feedback", () => {
  it("copies the current page URL and reports success", async () => {
    const written: string[] = [];
    const status = await copyPageLink("https://eesa.example/results", {
      writeText: async (value) => {
        written.push(value);
      },
    });

    assert.deepEqual(written, ["https://eesa.example/results"]);
    assert.equal(status, "copied");
    assert.equal(shareButtonLabel("copied"), "Link copied");
    assert.equal(shareButtonLabel("idle"), "Share");
  });

  it("reports failure when the clipboard rejects the write", async () => {
    const status = await copyPageLink("https://eesa.example/reports/1", {
      writeText: async () => {
        throw new Error("denied");
      },
    });

    assert.equal(status, "failed");
    assert.equal(shareButtonLabel("failed"), "Copy failed");
  });

  it("reports failure when no clipboard is available", async () => {
    assert.equal(await copyPageLink("https://eesa.example/results", undefined), "failed");
    assert.equal(await copyPageLink("   ", { writeText: async () => {} }), "failed");
  });
});

describe("published report download", () => {
  it("downloads the assessment, questions, and Bloom distribution already on the page", () => {
    const download = reportDownload({
      subjectName: "Data Structures",
      originalFileName: "ds-main.pdf",
      year: "2025",
      semester: "Sem 4",
      examType: "main",
      subjectCode: "CS301",
      branch: "CSE",
      totalQuestions: 2,
      totalMarks: 20,
      publishedAt: "2026-01-02T00:00:00.000Z",
      overallAssessment: "Balanced paper.",
      bloomDistribution: { Recall: 50, Apply: 50 },
      questions: [
        { questionText: "Define a stack.", bloomsLevel: "Recall", topic: "Stacks" },
        { questionText: "Apply a queue.", bloomsLevel: "Apply" },
      ],
      tags: ["stacks", "queues"],
    });

    assert.equal(download.fileName, "data-structures-report.txt");
    assert.equal(download.mimeType, "text/plain;charset=utf-8");
    assert.match(download.contents, /Subject: Data Structures/);
    assert.match(download.contents, /File: ds-main.pdf/);
    assert.match(download.contents, /Exam type: Main Exam/);
    assert.match(download.contents, /Subject code: CS301/);
    assert.match(download.contents, /Published: 2026-01-02/);
    assert.match(download.contents, /Overall assessment\r\nBalanced paper\./);
    assert.match(download.contents, /1\. \[Recall\] \[Stacks\] Define a stack\./);
    assert.match(download.contents, /2\. \[Apply\] Apply a queue\./);
    assert.match(download.contents, /Recall: 50\.0%/);
    assert.match(download.contents, /Apply: 50\.0%/);
    assert.match(download.contents, /Understand: 0\.0%/);
    assert.match(download.contents, /Tags: stacks, queues/);
    assert.doesNotMatch(download.contents, /s3:\/\//);
  });

  it("labels a KT paper and survives a report with no questions", () => {
    const download = reportDownload({
      subjectName: "   ",
      originalFileName: "kt.pdf",
      year: "2024",
      semester: "Sem 2",
      examType: "kt",
      totalQuestions: 0,
      publishedAt: "not-a-date",
      bloomDistribution: {},
    });

    assert.equal(download.fileName, "report.txt");
    assert.match(download.contents, /Exam type: KT Exam/);
    assert.match(download.contents, /Published: not-a-date/);
    assert.match(download.contents, /Questions: 0/);
    assert.match(download.contents, /No questions/);
  });
});

describe("results and report pages wire the controls", () => {
  it("exports the filtered results table, copies a link, and downloads one row", () => {
    const page = readFileSync(RESULTS_PAGE, "utf8");

    assert.match(page, /resultsDownload\(filteredResults, "exam-results\.csv"\)/);
    assert.match(page, /resultCsvFileName\(result\.examName\)/);
    assert.match(page, /copyPageLink\(/);
    assert.match(page, /shareButtonLabel\(shareStatus\)/);
    assert.match(page, /disabled=\{filteredResults\.length === 0\}/);
    assert.doesNotMatch(page, /<Button variant="ghost" size="sm">\s*<Download/);
  });

  it("shares the report URL and downloads the report shown on the page", () => {
    const page = readFileSync(REPORT_PAGE, "utf8");

    assert.match(page, /reportDownload\(report\)/);
    assert.match(page, /copyPageLink\(/);
    assert.match(page, /shareButtonLabel\(shareStatus\)/);
    assert.doesNotMatch(page, /href=\{[^}]*originalFileUrl/);
  });
});
