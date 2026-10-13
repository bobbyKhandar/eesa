/**
 * Ownership rules for upload-session job ids.
 *
 * A session may store an id before the pipeline job is written to MongoDB,
 * because that id has no metadata yet. Once a job document exists, only the
 * user recorded in `uploaded_by` may attach it or receive the document.
 * A stored job with no uploader is not readable: missing ownership is not
 * the same as the caller's ownership.
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
