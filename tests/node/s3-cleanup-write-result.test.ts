/**
 * A job whose S3 object is gone is only expired once the stored flag is
 * written. `JobMetadataRepository.markS3Expired` answers
 * `{ success: false }` when the update throws or matches no document, and the
 * cleanup service used to discard that result and count the job as expired.
 * The admin API then reported stored expirations that never happened, while the
 * row stayed selectable for the next cleanup run.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, afterEach, beforeEach, describe, it } from "node:test";

import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";

import "./s3-cleanup-write-result.boot.ts";
import { JobMetadataRepository } from "../../packages/backend/src/database/repositories/JobMetadataRepository.ts";
import { markExpiredJobs } from "../../packages/backend/src/services/s3CleanupService.ts";
import { restoreMongooseConnect } from "./s3-cleanup-write-result.boot.ts";

const JOB_ONE = "job-1";
const JOB_TWO = "job-2";
const JOB_MISSING_KEY = "job-3";

const originalSend = S3Client.prototype.send;
const originalFindOlderThan = JobMetadataRepository.prototype.findOlderThan;
const originalMarkS3Expired = JobMetadataRepository.prototype.markS3Expired;

let oldJobs: Array<Record<string, unknown>>;
let missingKeys: Set<string>;
let markOutcomes: Array<{ success: boolean; error?: string } | Error>;
const markCalls: string[] = [];

function key(jobId: string): string {
  return `jobs/${jobId}/report.pdf`;
}

function installCleanupStubs() {
  JobMetadataRepository.prototype.findOlderThan = (async () => oldJobs) as unknown as typeof originalFindOlderThan;
  JobMetadataRepository.prototype.markS3Expired = (async (jobId: string) => {
    markCalls.push(jobId);
    const next = markOutcomes.shift() ?? { success: true };
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof originalMarkS3Expired;

  S3Client.prototype.send = (async function send(command: any) {
    if (command instanceof HeadObjectCommand) {
      if (missingKeys.has(String(command.input.Key))) {
        const notFound = new Error("Not Found") as Error & {
          name: string;
          $metadata: { httpStatusCode: number };
        };
        notFound.name = "NotFound";
        notFound.$metadata = { httpStatusCode: 404 };
        throw notFound;
      }
      return {};
    }
    throw new Error(`Unexpected S3 command: ${command.constructor.name}`);
  }) as any;
}

function restoreCleanupStubs() {
  S3Client.prototype.send = originalSend;
  JobMetadataRepository.prototype.findOlderThan = originalFindOlderThan;
  JobMetadataRepository.prototype.markS3Expired = originalMarkS3Expired;
}

beforeEach(() => {
  oldJobs = [];
  missingKeys = new Set();
  markOutcomes = [];
  markCalls.length = 0;
});

afterEach(() => {
  restoreCleanupStubs();
});

after(() => {
  restoreCleanupStubs();
  restoreMongooseConnect();
});

describe("markExpiredJobs counts only stored expirations", () => {
  beforeEach(() => {
    installCleanupStubs();
  });

  it("does not count a job whose flag write reports a failure", async () => {
    oldJobs = [
      { job_id: JOB_ONE, s3_pdf_key: key(JOB_ONE) },
      { job_id: JOB_TWO, s3_pdf_key: key(JOB_TWO) },
      { job_id: JOB_MISSING_KEY, s3_pdf_key: key(JOB_MISSING_KEY) },
    ];
    missingKeys = new Set([key(JOB_ONE), key(JOB_TWO)]);
    markOutcomes = [{ success: true }, { success: false, error: "Job not found" }];

    const result = await markExpiredJobs(90);

    assert.equal(result.checked, 3);
    assert.equal(result.expired, 1);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], new RegExp(JOB_TWO), "the failed job must be named");
    assert.match(result.errors[0], /Job not found/, "the reason must be kept");
    assert.deepEqual(markCalls, [JOB_ONE, JOB_TWO]);
  });

  it("reports an update that matched no document as a failed expiration", async () => {
    oldJobs = [{ job_id: JOB_ONE, s3_pdf_key: key(JOB_ONE) }];
    missingKeys = new Set([key(JOB_ONE)]);
    markOutcomes = [{ success: false, error: "Job not found" }];

    const result = await markExpiredJobs(90);

    assert.equal(result.expired, 0);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], new RegExp(JOB_ONE));
    assert.deepEqual(markCalls, [JOB_ONE]);
  });

  it("keeps a swallowed write exception in errors with the job id", async () => {
    oldJobs = [{ job_id: JOB_ONE, s3_pdf_key: key(JOB_ONE) }];
    missingKeys = new Set([key(JOB_ONE)]);
    markOutcomes = [new Error("connection reset")];

    const result = await markExpiredJobs(90);

    assert.equal(result.expired, 0);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], new RegExp(JOB_ONE));
    assert.match(result.errors[0], /connection reset/);
  });

  it("counts every job whose object is gone and whose write succeeded", async () => {
    oldJobs = [
      { job_id: JOB_ONE, s3_pdf_key: key(JOB_ONE) },
      { job_id: JOB_TWO, s3_pdf_key: key(JOB_TWO) },
      { job_id: JOB_MISSING_KEY },
    ];
    missingKeys = new Set([key(JOB_ONE), key(JOB_TWO)]);

    const result = await markExpiredJobs(90);

    assert.equal(result.checked, 3);
    assert.equal(result.expired, 2);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(markCalls, [JOB_ONE, JOB_TWO]);
  });

  it("leaves a job whose object still exists untouched", async () => {
    oldJobs = [
      { job_id: JOB_ONE, s3_pdf_key: key(JOB_ONE) },
      { job_id: JOB_TWO, s3_pdf_key: key(JOB_TWO) },
    ];
    missingKeys = new Set([key(JOB_ONE)]);

    const result = await markExpiredJobs(90);

    assert.equal(result.checked, 2);
    assert.equal(result.expired, 1);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(markCalls, [JOB_ONE]);
  });

  it("still refuses an invalid retention window before checking any job", async () => {
    await assert.rejects(() => markExpiredJobs(0), /Invalid retention window: 0 days/);
    assert.deepEqual(markCalls, []);
  });
});

describe("JobMetadataRepository.markS3Expired reports the write result", () => {
  function useModel(repo: object, model: Record<string, unknown>) {
    (repo as { model: unknown }).model = model;
  }

  it("fails when the update throws", async () => {
    const repo = new JobMetadataRepository();
    useModel(repo, {
      updateOne() {
        throw new Error("mongo write failed");
      },
    });

    const outcome = await repo.markS3Expired(JOB_ONE);

    assert.equal(outcome.success, false);
    assert.match(outcome.error ?? "", /Failed to mark job as expired/);
  });

  it("fails when the update matched no document", async () => {
    const repo = new JobMetadataRepository();
    useModel(repo, {
      async updateOne() {
        return { modifiedCount: 0 };
      },
    });

    const outcome = await repo.markS3Expired(JOB_ONE);

    assert.equal(outcome.success, false);
    assert.equal(outcome.error, "Job not found");
  });

  it("succeeds when the update modifies the job", async () => {
    const repo = new JobMetadataRepository();
    let filter: unknown;
    let update: any;
    useModel(repo, {
      async updateOne(query: unknown, doc: unknown) {
        filter = query;
        update = doc;
        return { modifiedCount: 1 };
      },
    });

    const outcome = await repo.markS3Expired(JOB_ONE);

    assert.equal(outcome.success, true);
    assert.deepEqual(filter, { job_id: JOB_ONE });
    assert.equal(update.$set.s3_expired, true);
  });
});

describe("cleanup retry selection", () => {
  it("keeps selecting jobs whose s3_expired flag is still false", async () => {
    const repo = new JobMetadataRepository();
    let query: any;
    (repo as { model: unknown }).model = {
      find(filter: unknown) {
        query = filter;
        return {
          lean: async () => [],
        };
      },
    };

    const jobs = await repo.findOlderThan(90);

    assert.deepEqual(jobs, []);
    assert.equal(query.s3_expired, false);
    assert.equal(query.created_at.$lt instanceof Date, true);
  });
});

describe("POST /api/jobs/cleanup answer surfaces", () => {
  it("answers a run with failed jobs instead of a plain success", () => {
    const source = readFileSync(
      "packages/frontend/app/api/jobs/cleanup/route.ts",
      "utf8"
    );
    const handler = source.slice(source.indexOf("export async function POST"));

    assert.match(handler, /if \(result\.errors\.length > 0\)/);
    assert.match(handler, /success: false/);
    assert.match(handler, /status:\s*409/);
    assert.ok(
      handler.indexOf("status: 409") < handler.indexOf("success: true"),
      "a failed job must be answered before the success response"
    );
    assert.match(handler, /result\s*$|result\}/m, "the counts and errors must be returned");
  });
});
