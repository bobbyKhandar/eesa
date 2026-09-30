import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  markError,
  markSuccess,
  markUploading,
  mergeSplitSubjects,
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
    assert.equal(result[3].fileName, "b.pdf - Chem");
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

describe("markUploading / markSuccess / markError", () => {
  it("targets the entry by index rather than mutating the array", () => {
    const statuses = pending(["a.pdf", "b.pdf"]);
    const uploading = markUploading(statuses, 1);

    assert.notEqual(uploading, statuses);
    assert.equal(statuses[1].status, "pending");
    assert.equal(uploading[1].status, "uploading");
    assert.equal(uploading[1].progress, 0);
    assert.equal(uploading[0].status, "pending");
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

// Guards against a null/empty analysis list slipping through.
function mergeSplitStatusesOnNull(statuses: UploadStatus[]) {
  return mergeSplitSubjects(statuses, -1, "a.pdf", [{ analysisId: "1" }]);
}