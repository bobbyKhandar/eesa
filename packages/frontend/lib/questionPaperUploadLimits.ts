/**
 * Caps for admin question-paper batches.
 *
 * The Next.js route and the Flask upload route both read these variables.
 * A non-integer, blank, or non-positive value keeps the default so a bad
 * setting cannot remove the limit.
 */

export const DEFAULT_QUESTION_PAPER_MAX_FILE_BYTES = 25 * 1024 * 1024;
export const DEFAULT_QUESTION_PAPER_MAX_FILE_COUNT = 20;
export const DEFAULT_QUESTION_PAPER_MAX_REQUEST_BYTES = 200 * 1024 * 1024;

export const QUESTION_PAPER_MAX_FILE_BYTES_ENV = "QUESTION_PAPER_MAX_FILE_BYTES";
export const QUESTION_PAPER_MAX_FILE_COUNT_ENV = "QUESTION_PAPER_MAX_FILE_COUNT";
export const QUESTION_PAPER_MAX_REQUEST_BYTES_ENV = "QUESTION_PAPER_MAX_REQUEST_BYTES";

export type QuestionPaperUploadLimits = {
  maxFileBytes: number;
  maxFileCount: number;
  maxRequestBytes: number;
};

export type QuestionPaperUploadFile = {
  name: string;
  size: number;
};

export type QuestionPaperUploadDecision =
  | { ok: true }
  | { ok: false; status: 400 | 413; error: string };

function readPositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  if (!/^[0-9]+$/.test(trimmed)) return fallback;
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export function getQuestionPaperUploadLimits(): QuestionPaperUploadLimits {
  return {
    maxFileBytes: readPositiveInt(
      process.env[QUESTION_PAPER_MAX_FILE_BYTES_ENV],
      DEFAULT_QUESTION_PAPER_MAX_FILE_BYTES,
    ),
    maxFileCount: readPositiveInt(
      process.env[QUESTION_PAPER_MAX_FILE_COUNT_ENV],
      DEFAULT_QUESTION_PAPER_MAX_FILE_COUNT,
    ),
    maxRequestBytes: readPositiveInt(
      process.env[QUESTION_PAPER_MAX_REQUEST_BYTES_ENV],
      DEFAULT_QUESTION_PAPER_MAX_REQUEST_BYTES,
    ),
  };
}

/** Decimal Content-Length, or null when the header is missing or not an integer. */
export function parseContentLength(header: string | null): number | null {
  if (header === null) return null;
  const trimmed = header.trim();
  if (!/^[0-9]+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed)) return null;
  return parsed;
}

/**
 * Reject a batch before it is forwarded. Omit `files` to judge only Content-Length.
 * A size that is equal to a cap is allowed.
 */
export function assessQuestionPaperUpload(input: {
  files?: QuestionPaperUploadFile[];
  contentLength?: number | null;
  limits?: QuestionPaperUploadLimits;
}): QuestionPaperUploadDecision {
  const limits = input.limits ?? getQuestionPaperUploadLimits();
  const contentLength = input.contentLength;
  if (typeof contentLength === "number" && contentLength > limits.maxRequestBytes) {
    return {
      ok: false,
      status: 413,
      error: `Request is ${contentLength} bytes, which exceeds the ${limits.maxRequestBytes} byte request limit`,
    };
  }

  if (!input.files) return { ok: true };

  if (input.files.length > limits.maxFileCount) {
    return {
      ok: false,
      status: 400,
      error: `Too many files: received ${input.files.length}, maximum is ${limits.maxFileCount}`,
    };
  }

  let total = 0;
  for (const file of input.files) {
    const name = file.name || "upload";
    if (!Number.isFinite(file.size) || file.size < 0) {
      return {
        ok: false,
        status: 400,
        error: `File ${name} has an invalid size`,
      };
    }
    if (file.size > limits.maxFileBytes) {
      return {
        ok: false,
        status: 413,
        error: `File ${name} is ${file.size} bytes, which exceeds the ${limits.maxFileBytes} byte per-file limit`,
      };
    }
    total += file.size;
  }

  if (total > limits.maxRequestBytes) {
    return {
      ok: false,
      status: 413,
      error: `Upload is ${total} bytes, which exceeds the ${limits.maxRequestBytes} byte request limit`,
    };
  }

  return { ok: true };
}

/**
 * The pipeline's own 400/413 body names the limit that failed. Other statuses
 * keep the generic proxy message.
 */
export function forwardedPipelineError(status: number, body: string, statusText: string): string {
  const fallback = `Pipeline processing failed: ${statusText}`;
  if (status !== 400 && status !== 413) return fallback;
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === "object" && "error" in parsed) {
      const error = (parsed as { error: unknown }).error;
      if (typeof error === "string" && error.trim().length > 0) return error;
    }
  } catch {
    return fallback;
  }
  return fallback;
}
