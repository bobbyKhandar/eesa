import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { jobContentAccessDecision } from "../../../packages/frontend/lib/uploadSessionJobs.ts";

const owned = { uploaded_by: "user_owner" };
const foreign = { uploaded_by: "user_victim" };

describe("jobContentAccessDecision", () => {
  it("rejects a signed-out caller before any job data is considered", () => {
    const decision = jobContentAccessDecision({
      callerId: null,
      callerRole: null,
      jobs: [owned],
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.status, 401);
    assert.equal(decision.error, "Unauthorized");
  });

  it("allows the stored job's owner", () => {
    const decision = jobContentAccessDecision({
      callerId: "user_owner",
      callerRole: "student",
      jobs: [owned],
    });
    assert.equal(decision.allowed, true);
    assert.equal(decision.status, 200);
  });

  it("rejects a different signed-in user", () => {
    const decision = jobContentAccessDecision({
      callerId: "user_attacker",
      callerRole: "teacher",
      jobs: [foreign],
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.status, 403);
    assert.equal(decision.error, "You do not have access to this job");
  });

  it("rejects a stored job with no uploader", () => {
    for (const jobs of [[{ uploaded_by: undefined }], [{ uploaded_by: "" }], [{ uploaded_by: null }]]) {
      const decision = jobContentAccessDecision({
        callerId: "user_owner",
        callerRole: "student",
        jobs,
      });
      assert.equal(decision.allowed, false);
      assert.equal(decision.status, 403);
    }
  });

  it("rejects a job that is not stored yet for a non-admin", () => {
    for (const jobs of [undefined, null, []]) {
      const decision = jobContentAccessDecision({
        callerId: "user_owner",
        callerRole: "student",
        jobs,
      });
      assert.equal(decision.allowed, false, JSON.stringify(jobs));
      assert.equal(decision.status, 403);
    }
  });

  it("rejects when any stored copy is not owned by the caller", () => {
    const decision = jobContentAccessDecision({
      callerId: "user_owner",
      callerRole: "student",
      jobs: [owned, foreign],
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.status, 403);
  });

  it("allows an admin to read a foreign, unowned, or not-yet-stored job", () => {
    const cases = [[foreign], [{ uploaded_by: undefined }], [], undefined];
    for (const jobs of cases) {
      const decision = jobContentAccessDecision({
        callerId: "user_admin",
        callerRole: "admin",
        jobs,
      });
      assert.equal(decision.allowed, true, JSON.stringify(jobs));
      assert.equal(decision.status, 200);
    }
  });

  it("does not treat a missing account role as admin", () => {
    const decision = jobContentAccessDecision({
      callerId: "user_admin",
      callerRole: null,
      jobs: [],
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.status, 403);
  });
});

describe("job status and questions route wiring", () => {
  const statusRoute = readFileSync("packages/frontend/app/api/jobs/[jobId]/status/route.ts", "utf8");
  const questionsRoute = readFileSync(
    "packages/frontend/app/api/jobs/[jobId]/questions/route.ts",
    "utf8"
  );

  function assertGateBeforeRead(source: string, readMarker: string) {
    const gate = source.indexOf("if (denied) return denied;");
    const read = source.indexOf(readMarker);
    assert.notEqual(gate, -1);
    assert.notEqual(read, -1);
    assert.ok(gate < read, `${readMarker} runs before the ownership gate`);
  }

  it("authorizes the caller before returning status or calling the pipeline", () => {
    assert.match(statusRoute, /jobContentAccessDecision/);
    assert.match(statusRoute, /findByJobIds\(\[jobId\]\)/);
    assert.doesNotMatch(statusRoute, /findById\(/);
    assertGateBeforeRead(statusRoute, "buildJobStatusPayload(");
    assertGateBeforeRead(statusRoute, "fetchFromAiPipeline(");
  });

  it("authorizes the caller before proxying extracted questions", () => {
    assert.match(questionsRoute, /jobContentAccessDecision/);
    assert.match(questionsRoute, /findByJobIds\(\[jobId\]\)/);
    assertGateBeforeRead(questionsRoute, "fetchFromAiPipeline(");
  });

  it("authorizes the caller before proxying a retry", () => {
    const retryRoute = readFileSync("packages/frontend/app/api/jobs/[jobId]/retry/route.ts", "utf8");
    assert.match(retryRoute, /jobContentAccessDecision/);
    assert.match(retryRoute, /findByJobIds\(\[jobId\]\)/);
    assertGateBeforeRead(retryRoute, "fetchFromAiPipeline(");
  });
});
