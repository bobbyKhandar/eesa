/**
 * Mass-upload partial failures keep a per-file outcome through the proxy
 * and the admin UI (#167). Flask returns accepted jobs plus an errors array
 * naming each rejected file; the proxy must not drop those rows or report
 * the full submitted list as uploaded.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  acceptedMassUploadFileNames,
  parseMassUploadFailure,
  parseMassUploadFailures,
} from "../../../packages/frontend/lib/questionPaperUploadLimits.ts";

describe("parseMassUploadFailure", () => {
  it("splits a Flask 'filename: reason' string", () => {
    assert.deepEqual(parseMassUploadFailure("notes.txt: Only PDF files are allowed"), {
      filename: "notes.txt",
      error: "Only PDF files are allowed",
    });
  });

  it("keeps colons inside the reason and collapses whitespace", () => {
    assert.deepEqual(
      parseMassUploadFailure("a.pdf:  upload\n failed:  disk  full "),
      { filename: "a.pdf", error: "upload failed: disk full" },
    );
  });

  it("accepts a structured object entry", () => {
    assert.deepEqual(
      parseMassUploadFailure({ filename: "b.pdf", error: "S3 timeout" }),
      { filename: "b.pdf", error: "S3 timeout" },
    );
  });

  it("falls back to a safe reason instead of an empty string", () => {
    assert.deepEqual(parseMassUploadFailure("c.pdf:   "), {
      filename: "c.pdf",
      error: "Upload failed",
    });
    assert.deepEqual(parseMassUploadFailure("lonely.pdf"), {
      filename: "lonely.pdf",
      error: "Upload failed",
    });
  });

  it("caps a long reason so one row cannot bloat the response", () => {
    const parsed = parseMassUploadFailure(`d.pdf: ${"x".repeat(600)}`);
    assert.ok(parsed);
    assert.equal(parsed?.filename, "d.pdf");
    assert.equal(parsed?.error.length, 500);
  });

  it("drops entries without a filename", () => {
    assert.equal(parseMassUploadFailure("   : boom"), null);
    assert.equal(parseMassUploadFailure({ error: "boom" }), null);
    assert.equal(parseMassUploadFailure(null), null);
    assert.equal(parseMassUploadFailure(42), null);
  });
});

describe("parseMassUploadFailures", () => {
  it("parses an errors array and drops blank entries", () => {
    assert.deepEqual(
      parseMassUploadFailures(["a.pdf: bad", "", { filename: "b.pdf", error: "nope" }, null]),
      [
        { filename: "a.pdf", error: "bad" },
        { filename: "b.pdf", error: "nope" },
      ],
    );
  });

  it("returns an empty list for a missing errors field", () => {
    assert.deepEqual(parseMassUploadFailures(undefined), []);
    assert.deepEqual(parseMassUploadFailures("nope"), []);
  });
});

describe("acceptedMassUploadFileNames", () => {
  it("reads accepted names from jobs, not the submitted list", () => {
    assert.deepEqual(
      acceptedMassUploadFileNames([
        { job_id: "1", filename: "good.pdf" },
        { job_id: "2", filename: "  " },
        { job_id: "3" },
      ]),
      ["good.pdf"],
    );
  });

  it("returns an empty list for a missing jobs field", () => {
    assert.deepEqual(acceptedMassUploadFileNames(undefined), []);
    assert.deepEqual(acceptedMassUploadFileNames("nope"), []);
  });
});

describe("mass upload proxy preserves partial failures", () => {
  const source = readFileSync(
    "packages/frontend/app/api/upload/questionpaper/massupload/route.ts",
    "utf8",
  );

  it("derives the response from jobs and errors instead of the submitted list", () => {
    assert.match(source, /parseMassUploadFailures/);
    assert.match(source, /acceptedMassUploadFileNames/);
    assert.match(source, /const failed = parseMassUploadFailures\(result\.errors\)/);
    assert.match(source, /const acceptedFiles = acceptedMassUploadFileNames\(jobs\)/);
    // The accepted list must not be the whole submitted fileNames array.
    assert.doesNotMatch(source, /files:\s*fileNames/);
    assert.match(source, /partial/);
    assert.match(source, /failed/);
    assert.match(source, /errors:\s*failed\.map/);
  });

  it("keeps structured failures on the error path as well", () => {
    const errorBranch = source.slice(source.indexOf("if (!response.ok)"));
    assert.match(errorBranch, /parseMassUploadFailures/);
    assert.match(errorBranch, /failed/);
  });
});

describe("admin upload page surfaces and retries failed inputs", () => {
  const source = readFileSync(
    "packages/frontend/app/admin/upload/question-papers/page.tsx",
    "utf8",
  );

  it("tracks failed uploads separately from successful jobs", () => {
    assert.match(source, /failedUploads/);
    assert.match(source, /setFailedUploads/);
    assert.match(source, /Partial upload/);
  });

  it("retries only the failed files without re-uploading successes", () => {
    assert.match(source, /handleRetryFailedUploads/);
    assert.match(source, /retryFilesRef/);
    assert.match(source, /Retry failed only/);
  });

  it("shows each rejected filename with its reason", () => {
    assert.match(source, /Failed uploads/);
    assert.match(source, /entry\.filename/);
    assert.match(source, /entry\.error/);
  });
});
