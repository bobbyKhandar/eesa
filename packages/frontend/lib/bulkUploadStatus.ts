/**
 * Pure helpers for tracking bulk-upload progress in the browser.
 *
 * The bulk upload page processes one file at a time, but a single PDF can be
 * split by the API into several per-subject analyses. That means the status
 * array grows mid-loop, so file index and status index stop being the same
 * thing. These helpers keep the two concerns separated: every mutation is
 * addressed by the *file* index, and the array is rebuilt each time.
 *
 * Kept dependency-free so it can be unit tested without React/DOM.
 */

export type UploadStatusState =
  | "pending"
  | "uploading"
  | "processing"
  | "success"
  | "error";

export interface UploadExtractedMetadata {
  subjectName?: string;
  year?: string;
  semester?: string;
}

export interface UploadStatus {
  fileName: string;
  status: UploadStatusState;
  analysisId?: string;
  error?: string;
  progress?: number;
  extractedMetadata?: UploadExtractedMetadata;
}

/** Shape returned by POST /api/exam-analysis/upload-bulk for a split PDF. */
export interface SplitAnalysis {
  analysisId?: string;
  subjectName?: string;
  extractedMetadata?: UploadExtractedMetadata;
}

/**
 * Replace the entry for `fileIndex` with one entry per detected subject.
 * Entries for other files are preserved in order.
 */
export function mergeSplitSubjects(
  statuses: UploadStatus[],
  fileIndex: number,
  fileName: string,
  analyses: SplitAnalysis[]
): UploadStatus[] {
  if (fileIndex < 0 || fileIndex >= statuses.length) return statuses;

  const splitEntries: UploadStatus[] = (analyses ?? []).map((analysis) => ({
    fileName: `${fileName} - ${analysis.subjectName ?? "Unknown Subject"}`,
    status: "success",
    analysisId: analysis.analysisId,
    progress: 100,
    extractedMetadata: analysis.extractedMetadata,
  }));

  // If the API reported no usable analyses, keep the original entry as an error
  // rather than silently dropping the file from the report.
  const replacement: UploadStatus[] =
    splitEntries.length > 0
      ? splitEntries
      : [
          {
            ...statuses[fileIndex],
            status: "error",
            error: "No subjects detected",
          },
        ];

  return [
    ...statuses.slice(0, fileIndex),
    ...replacement,
    ...statuses.slice(fileIndex + 1),
  ];
}

/** Mark the entry for `fileIndex` as currently uploading. */
export function markUploading(
  statuses: UploadStatus[],
  fileIndex: number
): UploadStatus[] {
  if (fileIndex < 0 || fileIndex >= statuses.length) return statuses;
  const next = statuses.slice();
  next[fileIndex] = { ...next[fileIndex], status: "uploading", progress: 0 };
  return next;
}

/** Mark the entry for `fileIndex` as a successful single-subject upload. */
export function markSuccess(
  statuses: UploadStatus[],
  fileIndex: number,
  analysisId?: string,
  extractedMetadata?: UploadExtractedMetadata
): UploadStatus[] {
  if (fileIndex < 0 || fileIndex >= statuses.length) return statuses;
  const next = statuses.slice();
  next[fileIndex] = {
    ...next[fileIndex],
    status: "success",
    analysisId,
    progress: 100,
    extractedMetadata,
  };
  return next;
}

/** Mark the entry for `fileIndex` as failed. */
export function markError(
  statuses: UploadStatus[],
  fileIndex: number,
  error?: string
): UploadStatus[] {
  if (fileIndex < 0 || fileIndex >= statuses.length) return statuses;
  const next = statuses.slice();
  next[fileIndex] = {
    ...next[fileIndex],
    status: "error",
    error: error || "Upload failed",
  };
  return next;
}

export function isTerminalStatus(status: UploadStatusState): boolean {
  return status === "success" || status === "error";
}