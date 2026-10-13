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

/** JSON body from ingestBulkExamFile, shared by the single-file and ZIP routes. */
export interface BulkUploadBody {
  success?: boolean;
  error?: string;
  analysisId?: string;
  /** Server analysis lifecycle. A successful upload returns before this is completed. */
  status?: string;
  multipleSubjects?: boolean;
  analyses?: SplitAnalysis[];
  extractedMetadata?: UploadExtractedMetadata;
}

/**
 * Server lifecycle observed by the upload-status page.
 * `unavailable` means the poll failed and the row should stay as it is.
 */
export type AnalysisPollStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "published"
  | "missing"
  | "unavailable";

export interface AnalysisPollResult {
  analysisId: string;
  status: AnalysisPollStatus;
  processingError?: string;
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
    status: "processing",
    analysisId: analysis.analysisId,
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

/**
 * The file was accepted and an analysis record exists, but background
 * processing has not finished. Publish stays disabled until a later poll
 * reports the analysis completed.
 */
export function markProcessing(
  statuses: UploadStatus[],
  fileIndex: number,
  analysisId?: string,
  extractedMetadata?: UploadExtractedMetadata
): UploadStatus[] {
  if (fileIndex < 0 || fileIndex >= statuses.length) return statuses;
  const next = statuses.slice();
  const current = next[fileIndex];
  next[fileIndex] = {
    fileName: current.fileName,
    status: "processing",
    analysisId,
    extractedMetadata,
  };
  return next;
}

/**
 * Map one upload-bulk JSON body onto status rows.
 * Creating an analysis is not completion: the route returns while
 * processExamAnalysis is still running, so the row stays `processing`.
 */
export function statusesFromBulkResponse(
  fileName: string,
  body: BulkUploadBody | null
): UploadStatus[] {
  const seed: UploadStatus[] = [{ fileName, status: "uploading" }];
  if (body?.multipleSubjects && Array.isArray(body.analyses)) {
    return mergeSplitSubjects(seed, 0, fileName, body.analyses);
  }
  if (body?.success && typeof body.analysisId === "string" && body.analysisId.length > 0) {
    return markProcessing(seed, 0, body.analysisId, body.extractedMetadata);
  }
  return markError(seed, 0, body?.error || "Upload failed");
}

/** Analysis ids whose server status can still change the session. */
export function analysisIdsToPoll(statuses: UploadStatus[]): string[] {
  const ids: string[] = [];
  for (const row of statuses) {
    if (!row.analysisId) continue;
    if (row.status === "success" || row.status === "error") continue;
    ids.push(row.analysisId);
  }
  return ids;
}

/** True while any file is still uploading or its analysis is unfinished. */
export function isUploadSessionActive(statuses: UploadStatus[]): boolean {
  return statuses.some(
    (row) =>
      row.status === "pending" ||
      row.status === "uploading" ||
      row.status === "processing"
  );
}

/** Ids that finished analysis and can be sent to the publisher. */
export function publishableAnalysisIds(statuses: UploadStatus[]): string[] {
  return statuses.flatMap((row) =>
    row.status === "success" && row.analysisId ? [row.analysisId] : []
  );
}

/**
 * Fold a poll of GET /api/exam-analysis/:id into the session.
 * Only `completed` or `published` becomes a successful row.
 */
export function applyAnalysisPollResults(
  statuses: UploadStatus[],
  results: AnalysisPollResult[]
): UploadStatus[] {
  const byId = new Map(results.map((result) => [result.analysisId, result]));
  return statuses.map((row) => {
    if (!row.analysisId || row.status === "error") return row;
    const result = byId.get(row.analysisId);
    if (!result || result.status === "unavailable") return row;

    if (result.status === "completed" || result.status === "published") {
      return {
        ...row,
        status: "success",
        progress: 100,
        error: undefined,
      };
    }

    if (result.status === "failed") {
      return {
        ...row,
        status: "error",
        error: result.processingError || "Analysis failed",
      };
    }

    if (result.status === "missing") {
      return {
        ...row,
        status: "error",
        error: "Analysis not found",
      };
    }

    if (result.status === "pending" || result.status === "processing") {
      return {
        ...row,
        status: "processing",
        progress: undefined,
        error: undefined,
      };
    }

    return row;
  });
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