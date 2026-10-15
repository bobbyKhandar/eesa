import axios from "axios";
import fs from "fs";
import { interpretOcrFileResult, type OCRResult } from "./ocrFileResult.js";

export type { OCRResult, OcrFailedPage } from "./ocrFileResult.js";

const OCR_PIPELINE_URL = process.env.OCR_PIPELINE_URL || "http://localhost:5000";

function positiveEnvNumber(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Overall budget spanning submission, polling and result download. */
const OCR_TOTAL_TIMEOUT_MS = positiveEnvNumber("OCR_TOTAL_TIMEOUT_MS", 120000);
/** Per-request ceiling for status and result GETs (axios defaults to no timeout). */
const OCR_REQUEST_TIMEOUT_MS = positiveEnvNumber("OCR_REQUEST_TIMEOUT_MS", 60000);
/** Submission ceiling; the remaining overall budget still applies. */
const OCR_SUBMIT_TIMEOUT_MS = positiveEnvNumber("OCR_SUBMIT_TIMEOUT_MS", 120000);
const OCR_POLL_INTERVAL_MS = positiveEnvNumber("OCR_POLL_INTERVAL_MS", 2000);
const OCR_MAX_STATUS_ATTEMPTS = positiveEnvNumber("OCR_MAX_STATUS_ATTEMPTS", 60);

/** A stalled pipeline request that had to be given up on. */
class OcrTimeoutError extends Error {}

function budgetTimeout(label: string): OcrTimeoutError {
  return new OcrTimeoutError(
    `OCR ${label} timed out after ${OCR_TOTAL_TIMEOUT_MS}ms overall budget`
  );
}

function requestTimeout(label: string, ms: number): OcrTimeoutError {
  return new OcrTimeoutError(`OCR ${label} timed out after ${ms}ms request timeout`);
}

function remainingBudget(deadline: number): number {
  return deadline - Date.now();
}

function isRequestTimeout(error: any): boolean {
  return error?.code === "ECONNABORTED" || error?.code === "ETIMEDOUT";
}

/**
 * Run one pipeline request under the shared deadline.
 *
 * The request gets a per-call axios timeout capped to the remaining budget and
 * an abort signal that fires when the budget runs out, so a request that never
 * settles can no longer outlive the documented processing limit.
 */
async function withDeadline<T>(
  label: string,
  deadline: number,
  request: (timeoutMs: number, signal: AbortSignal) => Promise<T>
): Promise<T> {
  const remaining = remainingBudget(deadline);
  if (remaining <= 0) throw budgetTimeout(label);

  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      request(Math.min(OCR_REQUEST_TIMEOUT_MS, remaining), controller.signal),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(budgetTimeout(label));
        }, remaining);
      }),
    ]);
  } catch (error: any) {
    const cap = Math.min(OCR_REQUEST_TIMEOUT_MS, remaining);
    if (isRequestTimeout(error)) throw requestTimeout(label, cap);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isTimeoutError(error: any): boolean {
  return error instanceof OcrTimeoutError;
}

/**
 * Process a file through the OCR pipeline (Python AI Pipeline)
 * Supports PDF, DOCX, and images
 *
 * Every pipeline call is bounded by an overall deadline so a stalled status or
 * result request is reported as a failed, retryable analysis instead of leaving
 * the caller waiting forever.
 */
export async function processFileWithOCR(
  filePath: string,
  fileType: string
): Promise<OCRResult> {
  const deadline = Date.now() + OCR_TOTAL_TIMEOUT_MS;
  try {
    console.log(`Processing file with OCR: ${filePath}`);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    // Step 1: Submit batch to Python AI Pipeline
    // The Python pipeline expects file paths, not file uploads
    const submitResponse = await withDeadline("batch submission", deadline, (timeoutMs, signal) =>
      axios.post(
        `${OCR_PIPELINE_URL}/submit`,
        {
          file_locations: [filePath],
          options: {
            file_type: fileType,
          },
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: Math.min(OCR_SUBMIT_TIMEOUT_MS, timeoutMs),
          signal,
        }
      )
    );

    if (!submitResponse.data.success || !submitResponse.data.batch_id) {
      throw new Error("Failed to submit batch to OCR pipeline");
    }

    const batchId = submitResponse.data.batch_id;
    console.log(`Batch submitted with ID: ${batchId}`);

    // Step 2: Poll for results
    let attempts = 0;

    while (attempts < OCR_MAX_STATUS_ATTEMPTS) {
      const beforePoll = remainingBudget(deadline);
      if (beforePoll <= 0) throw budgetTimeout("processing");
      await sleep(Math.min(OCR_POLL_INTERVAL_MS, beforePoll));
      attempts++;

      // Check batch status
      const statusResponse = await withDeadline("status check", deadline, (timeoutMs, signal) =>
        axios.get(`${OCR_PIPELINE_URL}/status/${batchId}`, { timeout: timeoutMs, signal })
      );

      if (!statusResponse.data.success) {
        throw new Error("Failed to check batch status");
      }

      const status = statusResponse.data.status.status;
      console.log(`Batch ${batchId} status: ${status} (attempt ${attempts}/${OCR_MAX_STATUS_ATTEMPTS})`);

      if (status === "completed" || status === "partial") {
        const fileResult = await fetchFileResult(batchId, filePath, deadline);
        const interpreted = interpretOcrFileResult(fileResult, batchId);
        logOcrOutcome(interpreted);
        return interpreted;
      } else if (status === "failed") {
        const fileResult = await fetchFileResult(batchId, filePath, deadline).catch(() => undefined);
        if (fileResult) {
          const interpreted = interpretOcrFileResult(fileResult, batchId);
          logOcrOutcome(interpreted);
          if (!interpreted.success || (interpreted.failedPages && interpreted.failedPages.length > 0)) {
            return {
              ...interpreted,
              success: false,
              status: "failed",
            };
          }
        }

        const errors = statusResponse.data.status.errors || [];
        const message = errors.length
          ? `OCR processing failed: ${errors.join(", ")}`
          : "OCR processing failed";
        return {
          success: false,
          status: "failed",
          batchId,
          error: message,
          failedPages: [],
        };
      }
      // Continue polling if status is "pending" or "processing"
    }

    throw new OcrTimeoutError(
      `OCR processing timed out after ${OCR_MAX_STATUS_ATTEMPTS} status checks`
    );
  } catch (error: any) {
    console.error("OCR processing error:", error);
    return {
      success: false,
      status: "failed",
      error: error.message || "Failed to process file with OCR",
      ...(isTimeoutError(error) ? { retryable: true } : {}),
    };
  }
}

async function fetchFileResult(
  batchId: string,
  filePath: string,
  deadline: number
): Promise<Record<string, unknown>> {
  const resultResponse = await withDeadline("result download", deadline, (timeoutMs, signal) =>
    axios.get(`${OCR_PIPELINE_URL}/result/${batchId}`, { timeout: timeoutMs, signal })
  );

  if (!resultResponse.data.success) {
    throw new Error("Failed to retrieve batch result");
  }

  const fileResult = resultResponse.data.result?.results?.[filePath];
  if (!fileResult) {
    throw new Error("No result found for file");
  }
  return fileResult;
}

function logOcrOutcome(result: OCRResult): void {
  if (result.status === "partial") {
    console.warn(
      `OCR completed with failed pages${result.batchId ? ` for batch ${result.batchId}` : ""}: ${result.error}`
    );
    return;
  }
  if (!result.success) {
    console.error(`OCR failed${result.batchId ? ` for batch ${result.batchId}` : ""}: ${result.error}`);
    return;
  }
  console.log(`OCR completed successfully. Extracted ${result.text?.length ?? 0} characters`);
}

/**
 * Check OCR batch status
 */
export async function checkOCRStatus(batchId: string): Promise<{
  status: string;
  text?: string;
  error?: string;
}> {
  try {
    const response = await withDeadline(
      "status check",
      Date.now() + OCR_TOTAL_TIMEOUT_MS,
      (timeoutMs, signal) =>
        axios.get(`${OCR_PIPELINE_URL}/status/${batchId}`, { timeout: timeoutMs, signal })
    );

    if (!response.data.success) {
      throw new Error("Failed to check batch status");
    }

    return {
      status: response.data.status.status,
    };
  } catch (error: any) {
    console.error("Error checking OCR status:", error);
    return {
      status: "error",
      error: error.message,
    };
  }
}

/**
 * Process image file directly
 */
export async function processImageWithOCR(imagePath: string): Promise<OCRResult> {
  return processFileWithOCR(imagePath, "image");
}

/**
 * Process PDF file
 */
export async function processPDFWithOCR(pdfPath: string): Promise<OCRResult> {
  return processFileWithOCR(pdfPath, "pdf");
}

/**
 * Process DOCX file
 */
export async function processDOCXWithOCR(docxPath: string): Promise<OCRResult> {
  return processFileWithOCR(docxPath, "docx");
}

/**
 * Clean up OCR text (remove artifacts, normalize spacing)
 */
export function cleanOCRText(text: string): string {
  return text
    .replace(/\r\n/g, "\n") // Normalize line endings
    .replace(/\n{3,}/g, "\n\n") // Remove excessive newlines
    .replace(/[ \t]+/g, " ") // Normalize spaces
    .replace(/^\s+|\s+$/gm, "") // Trim lines
    .trim();
}
