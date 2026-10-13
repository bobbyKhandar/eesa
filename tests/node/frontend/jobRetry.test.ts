/**
 * The question-paper retry button posts to /api/jobs/:jobId/retry.
 * That route must authorize with jobContentAccessDecision before it calls
 * the pipeline, and the pipeline call must go through fetchFromAiPipeline
 * (which attaches the service token).
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  isRetryableJobStatus,
  jobRetryPipelinePath,
  mapPipelineRetryResponse,
} from "../../../packages/frontend/lib/jobRetry.ts";

describe("isRetryableJobStatus", () => {
  it("matches the statuses the upload page retries", () => {
    assert.equal(isRetryableJobStatus("failed"), true);
    assert.equal(isRetryableJobStatus("partial_success"), true);
    for (const status of ["success", "in_progress", "processing", "queued", "", undefined, null]) {
      assert.equal(isRetryableJobStatus(status), false, String(status));
    }
  });
});

describe("jobRetryPipelinePath", () => {
  it("targets the pipeline retry route and encodes the job id", () => {
    assert.equal(jobRetryPipelinePath("job-1"), "/job/job-1/retry");
    assert.equal(jobRetryPipelinePath("job/1"), "/job/job%2F1/retry");
  });
});

describe("mapPipelineRetryResponse", () => {
  it("passes through an accepted retry for the upload page", () => {
    const mapped = mapPipelineRetryResponse(202, {
      success: true,
      message: "Job retry started",
      job: { job_id: "job-1", filename: "paper.pdf", status: "in_progress" },
    });
    assert.equal(mapped.status, 202);
    assert.equal(mapped.body.success, true);
    assert.equal(mapped.body.message, "Job retry started");
    assert.equal(mapped.body.job?.status, "in_progress");
    assert.equal(mapped.body.job?.job_id, "job-1");
  });

  it("passes through a pipeline error message and status", () => {
    const mapped = mapPipelineRetryResponse(404, { success: false, error: "Job not found" });
    assert.equal(mapped.status, 404);
    assert.deepEqual(mapped.body, { success: false, error: "Job not found" });
  });

  it("does not treat a body without success as a started retry", () => {
    const mapped = mapPipelineRetryResponse(200, { status: "processing" });
    assert.equal(mapped.status, 502);
    assert.equal(mapped.body.success, false);
    assert.equal(mapped.body.error, "Failed to retry job");
  });

  it("uses a generic error when the pipeline body is empty", () => {
    const mapped = mapPipelineRetryResponse(503, null);
    assert.equal(mapped.status, 503);
    assert.equal(mapped.body.success, false);
    assert.equal(mapped.body.error, "Failed to retry job");
  });
});

describe("POST /api/jobs/[jobId]/retry", () => {
  const route = readFileSync("packages/frontend/app/api/jobs/[jobId]/retry/route.ts", "utf8");
  const repository = readFileSync(
    "packages/backend/src/database/repositories/JobMetadataRepository.ts",
    "utf8"
  );

  it("authorizes the caller before calling the pipeline or reopening a stored job", () => {
    assert.match(route, /jobContentAccessDecision/);
    assert.match(route, /findByJobIds\(\[jobId\]\)/);
    assert.doesNotMatch(route, /findById\(/);
    assert.match(route, /fetchFromAiPipeline\(\s*jobRetryPipelinePath\(jobId\)/);
    assert.match(route, /isRetryableJobStatus/);
    assert.match(route, /reopenForRetry\(/);
    assert.doesNotMatch(route, /192\.168\.1\.105/);

    const gate = route.indexOf("if (denied) return denied;");
    const call = route.indexOf("fetchFromAiPipeline(");
    const reopen = route.indexOf("reopenForRetry(");
    assert.ok(gate >= 0, "ownership gate missing");
    assert.ok(call > gate, "pipeline call must run after the ownership gate");
    assert.ok(reopen > call, "stored status must be reopened after the pipeline accepts the retry");
  });

  it("reopens only a stored failure so status polls follow the pipeline again", () => {
    const start = repository.indexOf("async reopenForRetry");
    assert.ok(start >= 0, "reopenForRetry missing");
    const method = repository.slice(start, start + 900);
    assert.match(method, /\$in:\s*\["failed",\s*"partial_success"\]/);
    assert.match(method, /status:\s*"in_progress"/);
    assert.match(method, /\$unset:\s*\{[^}]*error:/);
  });
});
