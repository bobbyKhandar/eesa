import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  callerOwnsStoredJob,
  foreignStoredJobIds,
  parseJobIdList,
  visibleSessionJob,
} from "../../../packages/frontend/lib/uploadSessionJobs.ts";

const victimJob = {
  job_id: "job-victim",
  uploaded_by: "user_victim",
  filename: "secret.pdf",
  s3_pdf_key: "jobs/job-victim/original/secret.pdf",
  stages: { parsing: { total_questions: 12 } },
  subjects: ["Biology"],
};

describe("parseJobIdList", () => {
  it("treats a missing list as empty", () => {
    assert.deepEqual(parseJobIdList(undefined, "job_ids"), { ok: true, ids: [] });
    assert.deepEqual(parseJobIdList(null, "job_ids"), { ok: true, ids: [] });
  });

  it("accepts an array of non-empty strings", () => {
    assert.deepEqual(parseJobIdList(["a", "b"], "job_ids"), { ok: true, ids: ["a", "b"] });
  });

  it("rejects values that are not a list of ids", () => {
    for (const value of ["job-1", 1, { job_id: "job-1" }, ["ok", ""], ["ok", 2]]) {
      const parsed = parseJobIdList(value, "add_job_ids");
      assert.equal(parsed.ok, false);
      if (!parsed.ok) {
        assert.match(parsed.error, /add_job_ids/);
      }
    }
  });
});

describe("upload session job ownership", () => {
  it("allows a job id that is not stored yet", () => {
    assert.deepEqual(foreignStoredJobIds("user_owner", ["job-new"], []), []);
  });

  it("allows a stored job uploaded by the caller", () => {
    assert.equal(callerOwnsStoredJob({ uploaded_by: "user_owner" }, "user_owner"), true);
    assert.deepEqual(
      foreignStoredJobIds("user_owner", ["job-own"], [{ job_id: "job-own", uploaded_by: "user_owner" }]),
      []
    );
  });

  it("rejects a job uploaded by someone else", () => {
    assert.deepEqual(
      foreignStoredJobIds("user_attacker", ["job-victim"], [victimJob]),
      ["job-victim"]
    );
  });

  it("rejects a stored job that has no uploader", () => {
    assert.equal(callerOwnsStoredJob({ uploaded_by: undefined }, "user_attacker"), false);
    assert.equal(callerOwnsStoredJob({ uploaded_by: "" }, "user_attacker"), false);
    assert.deepEqual(
      foreignStoredJobIds("user_attacker", ["job-legacy"], [{ job_id: "job-legacy" }]),
      ["job-legacy"]
    );
  });

  it("returns the full document only for the owner", () => {
    const visible = visibleSessionJob("job-victim", [victimJob], "user_victim");
    assert.equal(visible.filename, "secret.pdf");
    assert.equal(visible.s3_pdf_key, "jobs/job-victim/original/secret.pdf");
  });

  it("does not return another user's job metadata", () => {
    const visible = visibleSessionJob("job-victim", [victimJob], "user_attacker");
    assert.deepEqual(visible, {
      job_id: "job-victim",
      status: "unknown",
      error: "Job not found in database",
    });
    assert.equal("filename" in visible, false);
    assert.equal("s3_pdf_key" in visible, false);
    assert.equal("stages" in visible, false);
    assert.equal("subjects" in visible, false);
    assert.equal("uploaded_by" in visible, false);
  });

  it("uses the same placeholder when the job is not stored", () => {
    assert.deepEqual(visibleSessionJob("job-missing", [], "user_owner"), {
      job_id: "job-missing",
      status: "unknown",
      error: "Job not found in database",
    });
  });

  it("hides a stored job with no uploader", () => {
    const visible = visibleSessionJob(
      "job-legacy",
      [{ job_id: "job-legacy", filename: "legacy.pdf", uploaded_by: undefined }],
      "user_owner"
    );
    assert.equal("filename" in visible, false);
    assert.equal(visible.status, "unknown");
  });
});

describe("upload session route wiring", () => {
  const createRoute = readFileSync("packages/frontend/app/api/upload-sessions/route.ts", "utf8");
  const detailRoute = readFileSync(
    "packages/frontend/app/api/upload-sessions/[sessionId]/route.ts",
    "utf8"
  );
  const importRoute = readFileSync("packages/frontend/app/api/subjects/from-job/route.ts", "utf8");

  it("checks ownership before creating a session", () => {
    assert.match(createRoute, /foreignStoredJobIds/);
    assert.match(createRoute, /findByJobIds/);
    assert.doesNotMatch(createRoute, /job_ids:\s*job_ids\s*\|\|\s*\[\]/);
  });

  it("checks ownership before appending jobs and before returning job documents", () => {
    assert.match(detailRoute, /foreignStoredJobIds/);
    assert.match(detailRoute, /visibleSessionJob/);
    assert.doesNotMatch(detailRoute, /session\.job_ids\.map\(async \(jobId\) =>/);
  });

  it("records the importing user as the job owner", () => {
    assert.match(importRoute, /uploaded_by:\s*userId/);
  });
});
