/**
 * Example: Using EC2 OCR Service for Exam Analysis
 * 
 * This shows how to integrate the EC2-based OCR pipeline
 * with your existing exam analysis workflow
 */

import { ec2OcrClient } from './ec2OcrClient';
import type { BatchResult } from './ec2OcrClient';
import { analyzeWithGemini } from './geminiService'; // Your existing Gemini service

interface ExamAnalysisRequest {
  pdfPaths: string[];
  subjectName: string;
  year: string;
  semester: string;
  examType: 'main' | 'kt';
}

/**
 * Process exam PDFs using EC2 OCR and analyze with Gemini
 */
export async function processExamWithEC2OCR(request: ExamAnalysisRequest) {
  const { pdfPaths, subjectName, year, semester, examType } = request;

  console.log('🚀 Starting exam analysis with EC2 OCR...');
  console.log(`📄 Processing ${pdfPaths.length} PDF(s)`);

  try {
    // Step 1: Check EC2 service health
    console.log('🏥 Checking EC2 OCR service health...');
    const health = await ec2OcrClient.healthCheck();
    if (health.status !== 'healthy') {
      throw new Error('EC2 OCR service is not healthy');
    }
    console.log('✅ EC2 service is healthy');

    // Step 2: Submit batch for OCR processing
    console.log('📤 Submitting PDFs to EC2 for OCR...');
    const submitResponse = await ec2OcrClient.submitBatch(pdfPaths, {
      ocr_language: 'en',
      preprocessing: true,
      confidence_threshold: 0.6,
    });
    
    const batchId = submitResponse.batch_id;
    console.log(`📋 Batch submitted: ${batchId}`);

    // Step 3: Poll for completion (with progress updates)
    console.log('⏳ Waiting for OCR processing...');
    let lastProgress = 0;
    
    const pollInterval = setInterval(async () => {
      try {
        const status = await ec2OcrClient.getBatchStatus(batchId);
        const progress = Math.round((status.processed_files / status.total_files) * 100);
        
        if (progress > lastProgress) {
          console.log(`📊 Progress: ${progress}% (${status.processed_files}/${status.total_files} files)`);
          lastProgress = progress;
        }
      } catch (error) {
        console.error('Error checking status:', error);
      }
    }, 3000);

    // Wait for completion (max 10 minutes)
    const ocrResult = await ec2OcrClient.waitForBatch(batchId, 5000, 600000);
    clearInterval(pollInterval);

    console.log('✅ OCR processing complete!');
    console.log(`📝 Processed: ${ocrResult.results.length} files`);

    // Step 4: Extract and combine text from all PDFs
    const extractedTexts: Array<{
      fileName: string;
      text: string;
      confidence: number;
      processingTime: number;
    }> = [];

    for (const result of ocrResult.results) {
      if (result.status === 'success' && result.extracted_text) {
        extractedTexts.push({
          fileName: result.file_path.split('/').pop() || 'unknown',
          text: result.extracted_text,
          confidence: result.confidence || 0,
          processingTime: result.processing_time || 0,
        });
      } else {
        console.warn(`⚠️ Failed to process: ${result.file_path} - ${result.error}`);
      }
    }

    if (extractedTexts.length === 0) {
      throw new Error('No text extracted from any PDF');
    }

    // Step 5: Combine all extracted text
    const combinedText = extractedTexts.map(t => t.text).join('\n\n');
    const avgConfidence = extractedTexts.reduce((sum, t) => sum + t.confidence, 0) / extractedTexts.length;
    const totalProcessingTime = extractedTexts.reduce((sum, t) => sum + t.processingTime, 0);

    console.log(`📊 Average OCR confidence: ${(avgConfidence * 100).toFixed(1)}%`);
    console.log(`⏱️ Total OCR time: ${totalProcessingTime.toFixed(2)}s`);

    // Step 6: Analyze with Gemini AI
    console.log('🤖 Analyzing with Gemini AI...');
    const analysis = await analyzeWithGemini({
      extractedText: combinedText,
      subjectName,
      year,
      semester,
      examType,
    });

    console.log('✅ Analysis complete!');

    // Return complete analysis result
    return {
      success: true,
      batchId,
      ocrResults: {
        filesProcessed: extractedTexts.length,
        avgConfidence,
        totalProcessingTime,
        details: extractedTexts,
      },
      analysis,
    };

  } catch (error: any) {
    console.error('❌ Error processing exam:', error);
    throw new Error(`Exam analysis failed: ${error.message}`);
  }
}

/**
 * Example: Process multiple exams in parallel
 */
export async function processMultipleExams(requests: ExamAnalysisRequest[]) {
  console.log(`🚀 Processing ${requests.length} exams in parallel...`);

  const results = await Promise.allSettled(
    requests.map(request => processExamWithEC2OCR(request))
  );

  const successful = results.filter(r => r.status === 'fulfilled');
  const failed = results.filter(r => r.status === 'rejected');

  console.log(`✅ Successful: ${successful.length}`);
  console.log(`❌ Failed: ${failed.length}`);

  return {
    successful: successful.map(r => (r as PromiseFulfilledResult<any>).value),
    failed: failed.map(r => ({
      error: (r as PromiseRejectedResult).reason.message,
    })),
  };
}

/**
 * Example: Check OCR service statistics
 */
export async function getOCRServiceStats() {
  try {
    const stats = await ec2OcrClient.getStats();
    return {
      totalBatches: stats.total_batches_processed || 0,
      totalFiles: stats.total_files_processed || 0,
      avgProcessingTime: stats.avg_processing_time || 0,
      uptime: stats.uptime || 0,
    };
  } catch (error: any) {
    console.error('Error getting stats:', error);
    return null;
  }
}

/**
 * Example: Simple OCR-only function (no AI analysis)
 */
export async function extractTextFromPDF(pdfPath: string): Promise<string> {
  try {
    const result = await ec2OcrClient.processFiles([pdfPath], {
      ocr_language: 'en',
      preprocessing: true,
    });

    if (result.results.length === 0 || result.results[0].status !== 'success') {
      throw new Error('OCR extraction failed');
    }

    return result.results[0].extracted_text || '';
  } catch (error: any) {
    throw new Error(`Failed to extract text: ${error.message}`);
  }
}

// Export for use in routes
export { ec2OcrClient };
