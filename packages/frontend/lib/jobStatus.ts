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

/**
 * Decide which job statuses have extracted questions worth showing in the
 * admin job-details modal. `partial_success` means a later stage failed but
 * earlier stages may already have produced reviewable questions, so it must
 * behave like `success` here (the details modal used to gate on `success`
 * only and hid those questions).
 */
export function shouldShowJobQuestions(status: unknown): boolean {
  return status === "success" || status === "partial_success";
}

export const JOB_PIPELINE_STAGES = ["ocr", "parsing", "enrichment", "organization"] as const;

/**
 * List pipeline stages that did not complete successfully. Used to clearly
 * mark incomplete work on `partial_success` jobs in the details modal.
 */
export function getIncompleteJobStages(
  stages: Record<string, { status?: unknown } | null | undefined> | null | undefined
): string[] {
  if (!stages || typeof stages !== "object") return [...JOB_PIPELINE_STAGES];
  return (JOB_PIPELINE_STAGES as readonly string[]).filter(
    (stage) => (stages as Record<string, { status?: unknown } | null | undefined>)[stage]?.status !== "success"
  );
}
