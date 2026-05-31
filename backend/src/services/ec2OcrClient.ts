/**
 * EC2 OCR Client Service
 * Handles communication with AI Pipeline running on EC2
 */

import axios, { AxiosInstance } from 'axios';

export interface BatchSubmitRequest {
  file_locations: string[];
  options?: {
    ocr_language?: string;
    preprocessing?: boolean;
    confidence_threshold?: number;
  };
}

export interface BatchSubmitResponse {
  success: boolean;
  batch_id: string;
  message: string;
}

export interface BatchStatus {
  batch_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  total_files: number;
  processed_files: number;
  failed_files: number;
  created_at: number;
  updated_at: number;
  progress?: number;
}

export interface BatchResult {
  batch_id: string;
  status: string;
  results: Array<{
    file_path: string;
    status: 'success' | 'failed';
    extracted_text?: string;
    confidence?: number;
    processing_time?: number;
    error?: string;
  }>;
}

export class EC2OCRClient {
  private client: AxiosInstance;
  private ec2Url: string;

  constructor(ec2Url: string, timeout: number = 300000) {
    this.ec2Url = ec2Url.replace(/\/$/, ''); // Remove trailing slash
    
    this.client = axios.create({
      baseURL: this.ec2Url,
      timeout,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Check if the EC2 service is healthy
   */
  async healthCheck(): Promise<{ status: string; timestamp: number; pipeline_running: boolean }> {
    try {
      const response = await this.client.get('/health');
      return response.data;
    } catch (error: any) {
      throw new Error(`Health check failed: ${error.message}`);
    }
  }

  /**
   * Submit a batch of files for OCR processing
   */
  async submitBatch(fileLocations: string[], options?: BatchSubmitRequest['options']): Promise<BatchSubmitResponse> {
    try {
      const response = await this.client.post<BatchSubmitResponse>('/submit', {
        file_locations: fileLocations,
        options: options || {},
      });
      return response.data;
    } catch (error: any) {
      throw new Error(`Failed to submit batch: ${error.response?.data?.error || error.message}`);
    }
  }

  /**
   * Get the status of a batch
   */
  async getBatchStatus(batchId: string): Promise<BatchStatus> {
    try {
      const response = await this.client.get<{ success: boolean; status: BatchStatus }>(`/status/${batchId}`);
      return response.data.status;
    } catch (error: any) {
      throw new Error(`Failed to get batch status: ${error.response?.data?.error || error.message}`);
    }
  }

  /**
   * Get the results of a completed batch
   */
  async getBatchResult(batchId: string): Promise<BatchResult> {
    try {
      const response = await this.client.get<{ success: boolean; result: BatchResult }>(`/result/${batchId}`);
      return response.data.result;
    } catch (error: any) {
      throw new Error(`Failed to get batch result: ${error.response?.data?.error || error.message}`);
    }
  }

  /**
   * Wait for a batch to complete and return the results
   */
  async waitForBatch(batchId: string, pollInterval: number = 5000, maxWaitTime: number = 600000): Promise<BatchResult> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitTime) {
      const status = await this.getBatchStatus(batchId);
      
      if (status.status === 'completed') {
        return await this.getBatchResult(batchId);
      }
      
      if (status.status === 'failed') {
        throw new Error(`Batch processing failed for batch ${batchId}`);
      }
      
      // Wait before polling again
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
    
    throw new Error(`Batch processing timed out after ${maxWaitTime}ms`);
  }

  /**
   * Submit batch and wait for completion (convenience method)
   */
  async processFiles(
    fileLocations: string[],
    options?: BatchSubmitRequest['options'],
    pollInterval?: number,
    maxWaitTime?: number
  ): Promise<BatchResult> {
    const submitResponse = await this.submitBatch(fileLocations, options);
    return await this.waitForBatch(submitResponse.batch_id, pollInterval, maxWaitTime);
  }

  /**
   * Get pipeline statistics
   */
  async getStats(): Promise<any> {
    try {
      const response = await this.client.get('/stats');
      return response.data.stats;
    } catch (error: any) {
      throw new Error(`Failed to get stats: ${error.response?.data?.error || error.message}`);
    }
  }
}

/**
 * Create an EC2 OCR client instance
 */
export function createEC2OCRClient(ec2Url?: string, timeout?: number): EC2OCRClient {
  const url = ec2Url || process.env.EC2_OCR_URL || 'http://localhost:5000';
  return new EC2OCRClient(url, timeout);
}

// Export singleton instance
export const ec2OcrClient = createEC2OCRClient();
