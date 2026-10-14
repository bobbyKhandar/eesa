/**
 * Question-paper batches are rejected before the AI pipeline is called when
 * they exceed the configured file count, per-file size, or total request size.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  DEFAULT_QUESTION_PAPER_MAX_FILE_BYTES,
  DEFAULT_QUESTION_PAPER_MAX_FILE_COUNT,
  DEFAULT_QUESTION_PAPER_MAX_REQUEST_BYTES,
  assessQuestionPaperUpload,
  forwardedPipelineError,
  getQuestionPaperUploadLimits,
  parseContentLength,
} from "../../../packages/frontend/lib/questionPaperUploadLimits.ts";

const ENV_KEYS = [
  "QUESTION_PAPER_MAX_FILE_BYTES",
  "QUESTION_PAPER_MAX_FILE_COUNT",
  "QUESTION_PAPER_MAX_REQUEST_BYTES",
] as const;

function withUploadEnv(
  values: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>,
  run: () => void,
) {
  const previous = new Map<string, string | undefined>();
  for (const key of ENV_KEYS) {
    previous.set(key, process.env[key]);
    if (!Object.prototype.hasOwnProperty.call(values, key) || values[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = values[key];
    }
  }
  try {
    run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe("question paper upload limit configuration", () => {
  it("defaults to 25 MB per file, 20 files, and 200 MB per request", () => {
    withUploadEnv({}, () => {
      const limits = getQuestionPaperUploadLimits();
      assert.equal(limits.maxFileBytes, 25 * 1024 * 1024);
      assert.equal(limits.maxFileBytes, DEFAULT_QUESTION_PAPER_MAX_FILE_BYTES);
      assert.equal(limits.maxFileCount, 20);
      assert.equal(limits.maxFileCount, DEFAULT_QUESTION_PAPER_MAX_FILE_COUNT);
      assert.equal(limits.maxRequestBytes, 200 * 1024 * 1024);
      assert.equal(limits.maxRequestBytes, DEFAULT_QUESTION_PAPER_MAX_REQUEST_BYTES);
    });
  });

  it("reads positive integer overrides", () => {
    withUploadEnv(
      {
        QUESTION_PAPER_MAX_FILE_BYTES: "1024",
        QUESTION_PAPER_MAX_FILE_COUNT: "3",
        QUESTION_PAPER_MAX_REQUEST_BYTES: "4096",
      },
      () => {
        const limits = getQuestionPaperUploadLimits();
        assert.deepEqual(limits, {
          maxFileBytes: 1024,
          maxFileCount: 3,
          maxRequestBytes: 4096,
        });
      },
    );
  });

  it("keeps the defaults when an override is blank, zero, or not an integer", () => {
    withUploadEnv(
      {
        QUESTION_PAPER_MAX_FILE_BYTES: "  ",
        QUESTION_PAPER_MAX_FILE_COUNT: "0",
        QUESTION_PAPER_MAX_REQUEST_BYTES: "12.5",
      },
      () => {
        const limits = getQuestionPaperUploadLimits();
        assert.equal(limits.maxFileBytes, DEFAULT_QUESTION_PAPER_MAX_FILE_BYTES);
        assert.equal(limits.maxFileCount, DEFAULT_QUESTION_PAPER_MAX_FILE_COUNT);
        assert.equal(limits.maxRequestBytes, DEFAULT_QUESTION_PAPER_MAX_REQUEST_BYTES);
      },
    );
  });
});

describe("assessQuestionPaperUpload", () => {
  const limits = { maxFileBytes: 10, maxFileCount: 2, maxRequestBytes: 15 };

  it("parses a decimal content-length and ignores anything else", () => {
    assert.equal(parseContentLength(null), null);
    assert.equal(parseContentLength("  "), null);
    assert.equal(parseContentLength("20"), 20);
    assert.equal(parseContentLength("20.5"), null);
    assert.equal(parseContentLength("abc"), null);
  });

  it("rejects an oversized content-length with 413 before files are inspected", () => {
    const decision = assessQuestionPaperUpload({ contentLength: 16, limits });
    assert.equal(decision.ok, false);
    if (decision.ok) return;
    assert.equal(decision.status, 413);
    assert.match(decision.error, /16 bytes/);
    assert.match(decision.error, /15 byte request limit/);
  });

  it("rejects too many files with 400", () => {
    const decision = assessQuestionPaperUpload({
      files: [
        { name: "a.pdf", size: 1 },
        { name: "b.pdf", size: 1 },
        { name: "c.pdf", size: 1 },
      ],
      limits,
    });
    assert.equal(decision.ok, false);
    if (decision.ok) return;
    assert.equal(decision.status, 400);
    assert.match(decision.error, /received 3/);
    assert.match(decision.error, /maximum is 2/);
  });

  it("rejects one oversized file with 413", () => {
    const decision = assessQuestionPaperUpload({
      files: [
        { name: "small.pdf", size: 4 },
        { name: "huge.pdf", size: 11 },
      ],
      limits,
    });
    assert.equal(decision.ok, false);
    if (decision.ok) return;
    assert.equal(decision.status, 413);
    assert.match(decision.error, /huge\.pdf/);
    assert.match(decision.error, /11 bytes/);
    assert.match(decision.error, /per-file limit/);
  });

  it("rejects a batch whose files together exceed the request limit with 413", () => {
    const decision = assessQuestionPaperUpload({
      files: [
        { name: "a.pdf", size: 8 },
        { name: "b.pdf", size: 8 },
      ],
      limits,
    });
    assert.equal(decision.ok, false);
    if (decision.ok) return;
    assert.equal(decision.status, 413);
    assert.match(decision.error, /16 bytes/);
    assert.match(decision.error, /15 byte request limit/);
  });

  it("accepts a batch that sits on each limit", () => {
    const decision = assessQuestionPaperUpload({
      contentLength: 15,
      files: [
        { name: "a.pdf", size: 10 },
        { name: "b.pdf", size: 5 },
      ],
      limits,
    });
    assert.deepEqual(decision, { ok: true });
  });

  it("rejects an invalid file size with 400", () => {
    const decision = assessQuestionPaperUpload({
      files: [{ name: "a.pdf", size: Number.NaN }],
      limits,
    });
    assert.equal(decision.ok, false);
    if (decision.ok) return;
    assert.equal(decision.status, 400);
    assert.match(decision.error, /a\.pdf/);
  });
});

describe("forwardedPipelineError", () => {
  it("returns the pipeline message for 400 and 413", () => {
    const body = JSON.stringify({ success: false, error: "File paper.pdf is too large" });
    assert.equal(forwardedPipelineError(413, body, "Payload Too Large"), "File paper.pdf is too large");
    assert.equal(forwardedPipelineError(400, body, "Bad Request"), "File paper.pdf is too large");
  });

  it("keeps the generic message for other statuses and unreadable bodies", () => {
    assert.equal(
      forwardedPipelineError(500, JSON.stringify({ error: "boom" }), "Internal Server Error"),
      "Pipeline processing failed: Internal Server Error",
    );
    assert.equal(
      forwardedPipelineError(413, "not-json", "Payload Too Large"),
      "Pipeline processing failed: Payload Too Large",
    );
  });
});

describe("mass upload route enforces limits before the pipeline", () => {
  const source = readFileSync(
    "packages/frontend/app/api/upload/questionpaper/massupload/route.ts",
    "utf8",
  );

  it("checks the admin and content-length before parsing, then the files before forwarding", () => {
    const admin = source.indexOf("requireAdminCaller(");
    const contentLength = source.indexOf('req.headers.get("content-length")');
    const headerAssess = source.indexOf("assessQuestionPaperUpload(");
    const formData = source.indexOf("req.formData()");
    const fileAssess = source.indexOf("assessQuestionPaperUpload(", headerAssess + 1);
    const forward = source.indexOf("fetchFromAiPipeline(");
    assert.ok(admin >= 0, "admin check missing");
    assert.ok(contentLength > admin, "content-length check does not follow the admin gate");
    assert.ok(
      headerAssess > contentLength && headerAssess < formData,
      "request size check is not between the content-length read and body parse",
    );
    assert.ok(fileAssess > formData, "per-file limit check does not follow body parsing");
    assert.ok(forward > fileAssess, "pipeline forward does not follow the file limit check");
    assert.match(source, /fetchFromAiPipeline\(\s*"\/upload\/question-papers"/);
    assert.match(source, /const MASS_UPLOAD_PIPELINE_TIMEOUT_MS = 10 \* 60 \* 1000;/);
    assert.doesNotMatch(source, /\bfetch\(/);
    assert.doesNotMatch(source, /no size limit/);
  });
});
