import axios from "axios";
import fs from "fs";

const OCR_PIPELINE_URL = process.env.OCR_PIPELINE_URL || "http://localhost:5000";

interface OCRResult {
  success: boolean;
  text?: string;
  error?: string;
  batchId?: string;
}

/**
 * Process a file through the OCR pipeline (Python AI Pipeline)
 * Supports PDF, DOCX, and images
 */
export async function processFileWithOCR(
  filePath: string,
  fileType: string
): Promise<OCRResult> {
  try {
    console.log(`Processing file with OCR: ${filePath}`);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    // Step 1: Submit batch to Python AI Pipeline
    // The Python pipeline expects file paths, not file uploads
    const submitResponse = await axios.post(
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
        timeout: 120000, // 2 minute timeout
      }
    );

    if (!submitResponse.data.success || !submitResponse.data.batch_id) {
      throw new Error("Failed to submit batch to OCR pipeline");
    }

    const batchId = submitResponse.data.batch_id;
    console.log(`Batch submitted with ID: ${batchId}`);

    // Step 2: Poll for results
    let attempts = 0;
    const maxAttempts = 60; // 60 attempts * 2 seconds = 2 minutes max
    const pollInterval = 2000; // 2 seconds

    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      attempts++;

      // Check batch status
      const statusResponse = await axios.get(
        `${OCR_PIPELINE_URL}/status/${batchId}`
      );

      if (!statusResponse.data.success) {
        throw new Error("Failed to check batch status");
      }

      const status = statusResponse.data.status.status;
      console.log(`Batch ${batchId} status: ${status} (attempt ${attempts}/${maxAttempts})`);

      if (status === "completed") {
        // Get result
        const resultResponse = await axios.get(
          `${OCR_PIPELINE_URL}/result/${batchId}`
        );

        if (!resultResponse.data.success) {
          throw new Error("Failed to retrieve batch result");
        }

        const result = resultResponse.data.result;
        const fileResult = result.results[filePath];

        if (!fileResult) {
          throw new Error("No result found for file");
        }

        // Python server returns text in "combined_text" field
        const extractedText = fileResult.combined_text || fileResult.text || "";
        
        if (!extractedText) {
          throw new Error("No text extracted from file");
        }

        console.log(`OCR completed successfully. Extracted ${extractedText.length} characters`);
        return {
          success: true,
          text: extractedText,
          batchId,
        };
      } else if (status === "failed") {
        const errors = statusResponse.data.status.errors || [];
        throw new Error(`OCR processing failed: ${errors.join(", ")}`);
      }
      // Continue polling if status is "pending" or "processing"
    }

    throw new Error("OCR processing timed out");

  } catch (error: any) {
    console.error("OCR processing error:", error);
    return {
      success: false,
      error: error.message || "Failed to process file with OCR",
    };
  }
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
    const response = await axios.get(`${OCR_PIPELINE_URL}/status/${batchId}`);
    
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
