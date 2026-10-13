/**
 * Bulk upload must not report a file complete, or offer Publish All, while
 * exam analysis is still pending. Single-file and ZIP uploads share the
 * response mapper; the status page polls GET /api/exam-analysis/:id.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const BULK_PAGE = "packages/frontend/app/ai-analyze-bulk/page.tsx";
const STATUS_PAGE = "packages/frontend/app/upload-status/[sessionId]/page.tsx";
const ZIP_LIB = "packages/frontend/lib/bulkZipUpload.ts";
const STATUS_LIB = "packages/frontend/lib/bulkUploadStatus.ts";

describe("bulk upload completion wiring", () => {
  it("records single-file uploads with the same mapper the ZIP path uses", () => {
    const page = readFileSync(BULK_PAGE, "utf8");
    const zip = readFileSync(ZIP_LIB, "utf8");
    const statusLib = readFileSync(STATUS_LIB, "utf8");

    assert.match(page, /statusesFromBulkResponse\(/);
    assert.doesNotMatch(page, /markSuccess\(/);
    assert.doesNotMatch(page, /bulkZipUpload/);
    assert.match(zip, /statusesFromBulkResponse\(/);
    assert.match(statusLib, /function statusesFromBulkResponse/);
    assert.match(statusLib, /return markProcessing\(/);
  });

  it("polls analysis status before the session is complete or publishable", () => {
    const page = readFileSync(STATUS_PAGE, "utf8");

    assert.match(page, /analysisIdsToPoll\(/);
    assert.match(page, /applyAnalysisPollResults\(/);
    assert.match(page, /isUploadSessionActive\(/);
    assert.match(page, /publishableAnalysisIds\(/);
    assert.match(page, /\/api\/exam-analysis\/\$\{analysisId\}/);
  });
});
