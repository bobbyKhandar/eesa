import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { interpretOcrFileResult } from "../../packages/backend/src/services/ocrFileResult.ts";

/** Shared checks for the Node suites. Both test entry points call this. */
export function runOcrFailedPageChecks(): void {
  const clean = interpretOcrFileResult(
    {
      success: true,
      status: "success",
      combined_text: "full paper",
      failed_pages: 0,
      total_pages: 1,
      page_results: [{ page_number: 1, text: "full paper", success: true }],
    },
    "batch-clean"
  );
  assert.equal(clean.success, true);
  assert.equal(clean.status, "success");
  assert.equal(clean.text, "full paper");
  assert.equal(clean.batchId, "batch-clean");
  assert.deepEqual(clean.failedPages, []);
  assert.equal(clean.error, undefined);

  const docx = interpretOcrFileResult({
    success: true,
    failed_pages: 0,
    total_pages: 1,
    combined_text: "Q1. Define latency",
    page_results: [
      { page_number: 1, text: "Q1. Define latency", confidence: 1, success: true },
    ],
  });
  assert.equal(docx.success, true);
  assert.equal(docx.status, "success");
  assert.equal(docx.text, "Q1. Define latency");

  const partial = interpretOcrFileResult(
    {
      success: false,
      status: "partial",
      combined_text: "page one text",
      failed_pages: 1,
      failed_page_numbers: [2],
      total_pages: 2,
      error: "OCR failed for page 2 (timeout)",
      page_results: [
        { page_number: 1, text: "page one text", success: true },
        { page_number: 2, error: "timeout", success: false },
      ],
    },
    "batch-partial"
  );
  assert.equal(partial.success, true);
  assert.equal(partial.status, "partial");
  assert.equal(partial.text, "page one text");
  assert.equal(partial.batchId, "batch-partial");
  assert.deepEqual(partial.failedPages, [{ pageNumber: 2, error: "timeout" }]);
  assert.match(partial.error ?? "", /page 2/);
  assert.match(partial.error ?? "", /timeout/);

  const legacyPartial = interpretOcrFileResult({
    success: true,
    combined_text: "only page 1",
    failed_pages: 1,
    total_pages: 2,
    page_results: [
      { page_number: 1, text: "only page 1", success: true },
      { page_number: 4, success: false, error: "blur" },
    ],
  });
  assert.equal(legacyPartial.success, true);
  assert.equal(legacyPartial.status, "partial");
  assert.equal(legacyPartial.failedPages?.[0]?.pageNumber, 4);
  assert.match(legacyPartial.error ?? "", /page 4/);

  const allFailed = interpretOcrFileResult({
    success: true,
    combined_text: "",
    failed_pages: 2,
    total_pages: 2,
    page_results: [
      { page_number: 1, success: false, error: "blur" },
      { page_number: 3, success: false, error: "blank image" },
    ],
  });
  assert.equal(allFailed.success, false);
  assert.equal(allFailed.status, "failed");
  assert.equal(allFailed.text, undefined);
  assert.deepEqual(
    allFailed.failedPages?.map((page) => page.pageNumber),
    [1, 3]
  );
  assert.match(allFailed.error ?? "", /page 1/);
  assert.match(allFailed.error ?? "", /page 3/);
  assert.match(allFailed.error ?? "", /blur/);

  const docxFailure = interpretOcrFileResult({
    success: false,
    error: "No text extracted from DOCX: paper.docx",
  });
  assert.equal(docxFailure.success, false);
  assert.equal(docxFailure.status, "failed");
  assert.match(docxFailure.error ?? "", /DOCX/);
  assert.deepEqual(docxFailure.failedPages, []);

  const here = path.dirname(fileURLToPath(import.meta.url));
  const servicePath = path.resolve(here, "../../packages/backend/src/services/ocrService.ts");
  const service = readFileSync(servicePath, "utf8");
  assert.match(service, /interpretOcrFileResult\(/);
  assert.match(service, /status === "completed" \|\| status === "partial"/);
  assert.match(service, /\/result\/\$\{batchId\}/);
  assert.doesNotMatch(
    service,
    /return \{\s*success: true,\s*text: extractedText,\s*batchId,\s*\}/
  );
}
