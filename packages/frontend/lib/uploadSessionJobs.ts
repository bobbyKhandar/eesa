/**
 * Ownership rules for upload-session job ids and for job status / question reads.
 *
 * A session may store an id before the pipeline job is written to MongoDB,
 * because that id has no metadata yet. Once a job document exists, only the
 * user recorded in `uploaded_by` may attach it or receive the document.
 * A stored job with no uploader is not readable: missing ownership is not
 * the same as the caller's ownership.
 *
 * Status reads, extracted-question reads, and retries use the same stored-job
 * rule. A job that is not stored yet has no owner, so only an admin may fall
 * through to the AI pipeline.
 */

export interface StoredJobOwner {
  job_id: string;
  uploaded_by?: string | null;
}

export type JobIdListResult =
  | { ok: true; ids: string[] }
  | { ok: false; error: string };

const HIDDEN_JOB = {
  status: "unknown" as const,
  error: "Job not found in database",
};

export function parseJobIdList(value: unknown, fieldName: string): JobIdListResult {
  if (value == null) {
    return { ok: true, ids: [] };
  }

  if (!Array.isArray(value) || value.some((id) => typeof id !== "string" || id.trim().length === 0)) {
    return { ok: false, error: `${fieldName} must be an array of non-empty strings` };
  }

  return { ok: true, ids: value };
}

export function callerOwnsStoredJob(
  job: { uploaded_by?: string | null } | null | undefined,
  callerId: string
): boolean {
  return typeof job?.uploaded_by === "string"
    && job.uploaded_by.length > 0
    && job.uploaded_by === callerId;
}

/**
 * Ids whose stored documents the caller must not attach.
 * Ids with no stored document are omitted: there is nothing to disclose yet.
 */
export function foreignStoredJobIds(
  callerId: string,
  requestedIds: string[],
  storedJobs: StoredJobOwner[]
): string[] {
  return requestedIds.filter((id) => {
    const matches = storedJobs.filter((job) => job.job_id === id);
    if (matches.length === 0) {
      return false;
    }
    return matches.some((job) => !callerOwnsStoredJob(job, callerId));
  });
}

/**
 * Session detail payload for one job id.
 * Foreign and missing jobs share one placeholder so the response does not
 * confirm that another user's document exists.
 */
export function visibleSessionJob<T extends StoredJobOwner>(
  jobId: string,
  storedJobs: T[],
  callerId: string
): T | { job_id: string; status: "unknown"; error: string } {
  const matches = storedJobs.filter((job) => job.job_id === jobId);
  if (matches.length > 0 && matches.every((job) => callerOwnsStoredJob(job, callerId))) {
    return matches[0];
  }

  return {
    job_id: jobId,
    ...HIDDEN_JOB,
  };
}

export interface JobContentAccessDecision {
  allowed: boolean;
  status: number;
  error?: string;
}

/**
 * Reading job status or extracted questions, or retrying a job, requires a signed-in caller.
 *
 * A non-admin may read a job only when every stored copy is owned by them.
 * An admin may read a foreign job, a job with no uploader, or a job that is
 * not stored yet (the upload UI polls the pipeline before MongoDB has a row).
 */
export function jobContentAccessDecision(input: {
  callerId: string | null;
  callerRole?: string | null;
  jobs?: ReadonlyArray<{ uploaded_by?: string | null }> | null;
}): JobContentAccessDecision {
  if (!input.callerId) {
    return { allowed: false, status: 401, error: "Unauthorized" };
  }

  if (input.callerRole === "admin") {
    return { allowed: true, status: 200 };
  }

  const callerId = input.callerId;
  const jobs = input.jobs ?? [];
  if (jobs.length > 0 && jobs.every((job) => callerOwnsStoredJob(job, callerId))) {
    return { allowed: true, status: 200 };
  }

  return {
    allowed: false,
    status: 403,
    error: "You do not have access to this job",
  };
}
