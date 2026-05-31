/**
 * S3 Cleanup Service
 * Validates job S3 files and marks expired jobs in MongoDB
 */

import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";
import { JobMetadataRepository } from "../database/repositories/JobMetadataRepository";

const S3_BUCKET = process.env.S3_BUCKET || 'eesa-pipeline-storage';
const S3_REGION = process.env.AWS_REGION || 'ap-south-1';

const s3Client = new S3Client({ region: S3_REGION });
const jobRepo = new JobMetadataRepository();

/**
 * Check if an S3 object exists
 */
async function s3ObjectExists(key: string): Promise<boolean> {
  try {
    await s3Client.send(new HeadObjectCommand({
      Bucket: S3_BUCKET,
      Key: key
    }));
    return true;
  } catch (error: any) {
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw error;
  }
}

/**
 * Mark jobs as expired if their S3 files are deleted
 */
export async function markExpiredJobs(retentionDays: number = 90): Promise<{
  checked: number;
  expired: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let checked = 0;
  let expired = 0;

  try {
    console.log(`[S3 Cleanup] Checking jobs older than ${retentionDays} days...`);
    
    // Find jobs older than retention period that are not already marked expired
    const oldJobs = await jobRepo.findOlderThan(retentionDays);
    console.log(`[S3 Cleanup] Found ${oldJobs.length} jobs to check`);

    for (const job of oldJobs) {
      checked++;
      
      try {
        // Check if main PDF exists
        if (job.s3_pdf_key) {
          const exists = await s3ObjectExists(job.s3_pdf_key);
          
          if (!exists) {
            console.log(`[S3 Cleanup] Job ${job.job_id} S3 files not found, marking as expired`);
            await jobRepo.markS3Expired(job.job_id);
            expired++;
          }
        }
      } catch (error: any) {
        const errorMsg = `Failed to check job ${job.job_id}: ${error.message}`;
        console.error(`[S3 Cleanup] ${errorMsg}`);
        errors.push(errorMsg);
      }
    }

    console.log(`[S3 Cleanup] Complete: ${checked} checked, ${expired} marked as expired`);
    
    return { checked, expired, errors };
  } catch (error: any) {
    console.error('[S3 Cleanup] Error:', error);
    throw error;
  }
}

/**
 * Get cleanup statistics
 */
export async function getCleanupStats(): Promise<{
  total_jobs: number;
  expired_jobs: number;
  retention_days: number;
}> {
  const stats = await jobRepo.getStats();
  
  return {
    total_jobs: stats.total,
    expired_jobs: stats.expired,
    retention_days: 90
  };
}
