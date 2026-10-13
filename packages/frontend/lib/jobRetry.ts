/**
 * Shared helpers for POST /api/jobs/[jobId]/retry.
 *
 * The question-paper upload page treats `success` plus `job.status` as
 * "retry started" and then polls GET /api/jobs/[jobId]/status.
 */

export function isRetryableJobStatus(status: unknown): boolean {
  return status === "failed" || status === "partial_success";
}

export function jobRetryPipelinePath(jobId: string): string {
  return `/job/${encodeURIComponent(jobId)}/retry`;
}

export interface RetryProxyJob {
  job_id?: string;
  filename?: string;
  status?: string;
  s3_key?: string;
}

export interface RetryProxyBody {
  success: boolean;
  error?: string;
  message?: string;
  job?: RetryProxyJob;
}

/**
 * Shape a pipeline retry response for the upload page.
 * A 2xx body that does not say `success: true` is not a started retry.
 */
export function mapPipelineRetryResponse(
  pipelineStatus: number,
  body: unknown
): { status: number; body: RetryProxyBody } {
  const record =
    body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  const accepted =
    pipelineStatus >= 200 && pipelineStatus < 300 && record?.success === true;

  if (accepted && record) {
    const job =
      record.job && typeof record.job === "object"
        ? (record.job as RetryProxyJob)
        : undefined;
    return {
      status: pipelineStatus,
      body: {
        success: true,
        ...(typeof record.message === "string" ? { message: record.message } : {}),
        ...(job ? { job } : {}),
      },
    };
  }

  const error =
    record && typeof record.error === "string" && record.error.length > 0
      ? record.error
      : "Failed to retry job";
  const status = pipelineStatus >= 200 && pipelineStatus < 300 ? 502 : pipelineStatus;
  return { status, body: { success: false, error } };
}
