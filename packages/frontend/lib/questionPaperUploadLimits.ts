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
 * Structured per-file outcome for a mass upload that partially failed.
 *
 * Flask reports rejected files as `errors: ["name.pdf: reason"]` alongside
 * the accepted `jobs`. The proxy preserves that list in this shape so the
 * admin UI can name each failed file and retry it without re-uploading the
 * files that already started processing.
 */
export type MassUploadFailure = {
  filename: string;
  error: string;
};

/** Failure reasons are single-line operator text, capped so one row cannot bloat the response. */
export const MASS_UPLOAD_FAILURE_REASON_MAX_CHARS = 500;

function sanitizeMassUploadFilename(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const trimmed = name.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, 255);
}

function sanitizeMassUploadReason(reason: unknown): string {
  if (typeof reason !== "string") return "Upload failed";
  const collapsed = reason.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return "Upload failed";
  return collapsed.slice(0, MASS_UPLOAD_FAILURE_REASON_MAX_CHARS);
}

/** Parse one Flask `errors` entry (`"name.pdf: reason"` or `{ filename, error }`). */
export function parseMassUploadFailure(entry: unknown): MassUploadFailure | null {
  if (typeof entry === "string") {
    const separator = entry.indexOf(":");
    if (separator < 0) {
      const filename = sanitizeMassUploadFilename(entry);
      if (!filename) return null;
      return { filename, error: "Upload failed" };
    }
    const filename = sanitizeMassUploadFilename(entry.slice(0, separator));
    if (!filename) return null;
    return { filename, error: sanitizeMassUploadReason(entry.slice(separator + 1)) };
  }
  if (entry && typeof entry === "object") {
    const record = entry as Record<string, unknown>;
    const filename = sanitizeMassUploadFilename(
      record.filename ?? record.file ?? record.name,
    );
    if (!filename) return null;
    return {
      filename,
      error: sanitizeMassUploadReason(record.error ?? record.message ?? record.reason),
    };
  }
  return null;
}

/** Parse a Flask `errors` array into structured rows, dropping blank entries. */
export function parseMassUploadFailures(errors: unknown): MassUploadFailure[] {
  if (!Array.isArray(errors)) return [];
  const failures: MassUploadFailure[] = [];
  for (const entry of errors) {
    const parsed = parseMassUploadFailure(entry);
    if (parsed) failures.push(parsed);
  }
  return failures;
}

/** Accepted filenames come from the pipeline jobs, never from the submitted list. */
export function acceptedMassUploadFileNames(jobs: unknown): string[] {
  if (!Array.isArray(jobs)) return [];
  const names: string[] = [];
  for (const job of jobs) {
    if (job && typeof job === "object") {
      const filename = sanitizeMassUploadFilename(
        (job as Record<string, unknown>).filename,
      );
      if (filename) names.push(filename);
    }
  }
  return names;
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
