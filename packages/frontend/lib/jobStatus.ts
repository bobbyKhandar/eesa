/**
 * Pure helpers for the job status API route and the job polling UI.
 */

/** Statuses after which a job can no longer change on its own. */
export const TERMINAL_JOB_STATUSES = ["success", "failed", "partial_success"] as const;

export type TerminalJobStatus = (typeof TERMINAL_JOB_STATUSES)[number];

export function isTerminalJobStatus(status: unknown): status is TerminalJobStatus {
  return typeof status === "string" && (TERMINAL_JOB_STATUSES as readonly string[]).includes(status);
}

export const JOB_STATUS_SOURCE = {
  mongodb: "mongodb",
  mongodbStale: "mongodb-stale",
  pipeline: "python-server",
} as const;

/**
 * Normalise a MongoDB job document into the public status payload.
 * Keeping the field list explicit avoids leaking raw mongo internals (`_id`,
 * `__v`, ...) through `...jobMetadata`.
 */
export function buildJobStatusPayload(
  jobMetadata: Record<string, any> | null | undefined,
  source: string,
  extra: Record<string, unknown> = {}
): Record<string, unknown> | null {
  if (!jobMetadata) return null;

  return {
    job_id: jobMetadata.job_id,
    filename: jobMetadata.filename,
    status: jobMetadata.status,
    stages: jobMetadata.stages,
    error: jobMetadata.error,
    error_type: jobMetadata.error_type,
    failed_stage: jobMetadata.failed_stage,
    started_at: jobMetadata.started_at,
    completed_at: jobMetadata.completed_at,
    total_questions: jobMetadata.total_questions,
    subjects: jobMetadata.subjects,
    s3_expired: jobMetadata.s3_expired,
    s3_pdf_key: jobMetadata.s3_pdf_key,
    source,
    ...extra,
  };
}

/**
 * Decide which job statuses the admin upload UI should stop polling.
 * `partial_success` used to be polled every 5s forever even though the status
 * API treats it as final.
 */
export function shouldPollJobStatus(status: unknown): boolean {
  if (typeof status !== "string" || status.length === 0) return true;
  return !isTerminalJobStatus(status);
}
