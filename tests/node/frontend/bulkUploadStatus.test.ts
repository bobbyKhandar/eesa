import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  analysisIdsToPoll,
  applyAnalysisPollResults,
  isUploadSessionActive,
  markError,
  markProcessing,
  markSuccess,
  markUploading,
  mergeSplitSubjects,
  publishableAnalysisIds,
  type UploadStatus,
} from "../../../packages/frontend/lib/bulkUploadStatus.ts";

const pending = (fileNames: string[]): UploadStatus[] =>
  fileNames.map((fileName) => ({ fileName, status: "pending" }));

describe("mergeSplitSubjects", () => {
  it("expands one file into one entry per detected subject", () => {
    const result = mergeSplitSubjects(pending(["a.pdf", "b.pdf"]), 0, "a.pdf", [
      { analysisId: "1", subjectName: "Physics", extractedMetadata: { subjectName: "Physics" } },
      { analysisId: "2", subjectName: "Maths", extractedMetadata: { subjectName: "Maths" } },
    ]);

    assert.equal(result.length, 3);
    assert.deepEqual(
      result.map((s) => s.fileName),
      ["a.pdf - Physics", "a.pdf - Maths", "b.pdf"]
    );
    assert.deepEqual(
      result.slice(0, 2).map((s) => s.analysisId),
      ["1", "2"]
    );
    assert.deepEqual(
      result.slice(0, 2).map((s) => s.status),
      ["processing", "processing"]
    );
    assert.equal(result[0].progress, undefined);
  });

  it("keeps surrounding files untouched", () => {
    const statuses = [
      { fileName: "a.pdf", status: "success", analysisId: "1" },
      { fileName: "b.pdf", status: "pending" },
      { fileName: "c.pdf", status: "pending" },
    ] as UploadStatus[];

    const result = mergeSplitSubjects(statuses, 1, "b.pdf", [
      { analysisId: "2", subjectName: "Physics" },
      { analysisId: "3", subjectName: "Maths" },
      { analysisId: "4", subjectName: "Chem" },
    ]);

    assert.equal(result.length, 5);
    assert.equal(result[0].analysisId, "1");
    assert.equal(result[0].status, "success");
    assert.equal(result[1].fileName, "b.pdf - Physics");
    assert.equal(result[1].status, "processing");
    assert.equal(result[3].fileName, "b.pdf - Chem");
    assert.equal(result[3].status, "processing");
    assert.equal(result[4].fileName, "c.pdf");
  });

  it("marks the entry as failed when no subjects come back", () => {
    const result = mergeSplitSubjects(pending(["a.pdf"]), 0, "a.pdf", []);

    assert.equal(result.length, 1);
    assert.equal(result[0].status, "error");
    assert.equal(result[0].error, "No subjects detected");
  });

  it("is a no-op for an out-of-range file index", () => {
    const statuses = pending(["a.pdf"]);
    assert.equal(mergeSplitSubjects(statuses, 5, "a.pdf", [{ analysisId: "1" }]), statuses);
    assert.equal(mergeSplitStatusesOnNull(statuses), statuses);
  });
});

describe("markUploading / markProcessing / markSuccess / markError", () => {
  it("targets the entry by index rather than mutating the array", () => {
    const statuses = pending(["a.pdf", "b.pdf"]);
    const uploading = markUploading(statuses, 1);

    assert.notEqual(uploading, statuses);
    assert.equal(statuses[1].status, "pending");
    assert.equal(uploading[1].status, "uploading");
    assert.equal(uploading[1].progress, 0);
    assert.equal(uploading[0].status, "pending");
  });

  it("records an accepted upload as processing, not finished", () => {
    const result = markProcessing(pending(["a.pdf"]), 0, "abc", {
      subjectName: "Physics",
      year: "2024",
    });

    assert.equal(result[0].status, "processing");
    assert.equal(result[0].analysisId, "abc");
    assert.equal(result[0].progress, undefined);
    assert.equal(result[0].extractedMetadata?.year, "2024");
    assert.equal(isUploadSessionActive(result), true);
    assert.deepEqual(publishableAnalysisIds(result), []);
  });

  it("records the analysis id and metadata on success", () => {
    const result = markSuccess(pending(["a.pdf"]), 0, "abc", {
      subjectName: "Physics",
      year: "2024",
    });

    assert.equal(result[0].status, "success");
    assert.equal(result[0].analysisId, "abc");
    assert.equal(result[0].progress, 100);
    assert.equal(result[0].extractedMetadata?.year, "2024");
  });

  it("records a default error message", () => {
    assert.equal(markError(pending(["a.pdf"]), 0)[0].error, "Upload failed");
    assert.equal(markError(pending(["a.pdf"]), 0, "boom")[0].error, "boom");
  });
});

describe("analysis polling", () => {
  const processing = (analysisId: string): UploadStatus => ({
    fileName: "paper.pdf",
    status: "processing",
    analysisId,
    extractedMetadata: { subjectName: "Physics" },
  });

  it("polls rows that are not finished and skips errors and confirmed successes", () => {
    const statuses: UploadStatus[] = [
      { fileName: "up.pdf", status: "uploading" },
      processing("pending-1"),
      { fileName: "done.pdf", status: "success", analysisId: "done-1", progress: 100 },
      { fileName: "bad.pdf", status: "error", analysisId: "bad-1", error: "Upload failed" },
    ];

    assert.deepEqual(analysisIdsToPoll(statuses), ["pending-1"]);
    assert.equal(isUploadSessionActive(statuses), true);
    assert.deepEqual(publishableAnalysisIds(statuses), ["done-1"]);
  });

  it("promotes a row only after the server reports the analysis completed", () => {
    const uploaded = [processing("an-1")];
    assert.deepEqual(publishableAnalysisIds(uploaded), []);

    const stillPending = applyAnalysisPollResults(uploaded, [
      { analysisId: "an-1", status: "pending" },
    ]);
    assert.equal(stillPending[0].status, "processing");
    assert.equal(stillPending[0].extractedMetadata?.subjectName, "Physics");
    assert.equal(isUploadSessionActive(stillPending), true);

    const done = applyAnalysisPollResults(stillPending, [
      { analysisId: "an-1", status: "completed" },
    ]);
    assert.equal(done[0].status, "success");
    assert.equal(done[0].progress, 100);
    assert.equal(done[0].analysisId, "an-1");
    assert.equal(isUploadSessionActive(done), false);
    assert.deepEqual(publishableAnalysisIds(done), ["an-1"]);
  });

  it("records a failed analysis and leaves unrelated rows alone", () => {
    const statuses: UploadStatus[] = [
      processing("an-1"),
      { fileName: "other.pdf", status: "processing", analysisId: "an-2" },
      { fileName: "kept.pdf", status: "error", error: "Upload failed" },
    ];

    const next = applyAnalysisPollResults(statuses, [
      { analysisId: "an-1", status: "failed", processingError: "OCR failed" },
      { analysisId: "an-2", status: "unavailable" },
    ]);

    assert.equal(next[0].status, "error");
    assert.equal(next[0].error, "OCR failed");
    assert.equal(next[1].status, "processing");
    assert.equal(next[2].status, "error");
    assert.equal(next[2].error, "Upload failed");
    assert.equal(isUploadSessionActive(next), true);
    assert.deepEqual(publishableAnalysisIds(next), []);
  });

  it("uses a default failure message and treats a missing analysis as failed", () => {
    const next = applyAnalysisPollResults(
      [processing("gone"), { fileName: "b.pdf", status: "processing", analysisId: "blank" }],
      [
        { analysisId: "gone", status: "missing" },
        { analysisId: "blank", status: "failed" },
      ]
    );

    assert.equal(next[0].error, "Analysis not found");
    assert.equal(next[1].error, "Analysis failed");
    assert.equal(isUploadSessionActive(next), false);
  });

  it("treats an already published analysis as finished", () => {
    const next = applyAnalysisPollResults([processing("an-1")], [
      { analysisId: "an-1", status: "published" },
    ]);

    assert.equal(next[0].status, "success");
    assert.deepEqual(publishableAnalysisIds(next), ["an-1"]);
    assert.equal(isUploadSessionActive(next), false);
  });
});

// Guards against a null/empty analysis list slipping through.
function mergeSplitStatusesOnNull(statuses: UploadStatus[]) {
  return mergeSplitSubjects(statuses, -1, "a.pdf", [{ analysisId: "1" }]);
}