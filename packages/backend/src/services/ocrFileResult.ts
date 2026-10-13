/**
 * Turn one AI-pipeline file payload into the OCR result the Node client returns.
 *
 * A clean success is only reported when no page was dropped. Partial OCR keeps
 * the text from pages that succeeded and records the pages that were lost.
 * The call fails when there is no usable text, including when every page failed.
 * DOCX extraction has no failed pages; a successful extraction stays a clean success.
 */

export interface OcrFailedPage {
  pageNumber: number;
  error?: string;
}

export interface OCRResult {
  success: boolean;
  text?: string;
  error?: string;
  batchId?: string;
  status?: "success" | "partial" | "failed";
  failedPages?: OcrFailedPage[];
}

interface PipelinePageResult {
  page_number?: unknown;
  success?: unknown;
  error?: unknown;
}

interface PipelineFileResult {
  success?: unknown;
  status?: unknown;
  combined_text?: unknown;
  text?: unknown;
  error?: unknown;
  failed_pages?: unknown;
  failed_page_numbers?: unknown;
  total_pages?: unknown;
  page_results?: unknown;
}

export function interpretOcrFileResult(
  fileResult: PipelineFileResult | null | undefined,
  batchId?: string
): OCRResult {
  const failedPages = collectFailedPages(fileResult);
  const text = readableText(fileResult?.combined_text) || readableText(fileResult?.text);
  const pipelineStatus = readableText(fileResult?.status);
  const pipelineError = readableText(fileResult?.error);
  const failedCount = numeric(fileResult?.failed_pages) ?? failedPages.length;

  if (!text) {
    return {
      success: false,
      status: "failed",
      batchId,
      failedPages,
      error: failedPages.length
        ? lostPagesMessage(failedPages)
        : pipelineError || "No text extracted from file",
    };
  }

  const partial =
    pipelineStatus === "partial" || failedCount > 0 || failedPages.length > 0;

  if (pipelineStatus === "failed" && !partial) {
    return {
      success: false,
      status: "failed",
      batchId,
      failedPages,
      error: pipelineError || "OCR processing failed",
    };
  }

  if (partial) {
    return {
      success: true,
      status: "partial",
      text,
      batchId,
      failedPages,
      error: lostPagesMessage(failedPages, pipelineError),
    };
  }

  if (fileResult?.success === false) {
    return {
      success: false,
      status: "failed",
      batchId,
      failedPages,
      error: pipelineError || "OCR processing failed",
    };
  }

  return {
    success: true,
    status: "success",
    text,
    batchId,
    failedPages: [],
  };
}

function collectFailedPages(fileResult: PipelineFileResult | null | undefined): OcrFailedPage[] {
  const pages: OcrFailedPage[] = [];
  const pageResults = Array.isArray(fileResult?.page_results) ? fileResult.page_results : [];

  for (const page of pageResults) {
    if (!page || typeof page !== "object") continue;
    const entry = page as PipelinePageResult;
    if (entry.success !== false) continue;
    const pageNumber = finiteNumber(entry.page_number);
    if (pageNumber === undefined) continue;
    const error = readableText(entry.error);
    pages.push(error ? { pageNumber, error } : { pageNumber });
  }

  if (pages.length > 0) return pages;

  const numbers = Array.isArray(fileResult?.failed_page_numbers)
    ? fileResult.failed_page_numbers
    : [];
  for (const value of numbers) {
    const pageNumber = finiteNumber(value);
    if (pageNumber === undefined) continue;
    pages.push({ pageNumber });
  }
  return pages;
}

function lostPagesMessage(pages: OcrFailedPage[], fallback?: string): string {
  if (pages.length === 0) return fallback || "OCR failed";
  const detail = pages
    .map((page) =>
      page.error ? `page ${page.pageNumber} (${page.error})` : `page ${page.pageNumber}`
    )
    .join(", ");
  return `OCR failed for ${detail}`;
}

function readableText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numeric(value: unknown): number | undefined {
  return finiteNumber(value);
}

function finiteNumber(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}
