/**
 * JobMetadata Repository - Pipeline Job Tracking Operations
 * Handles all database operations for job metadata
 */

import { Types } from "mongoose";
import type { Model } from "mongoose";
import { connect } from "../connect";
import { getJobMetadataModel } from "../mongooseSchemas";
import { jobMetadataZodSchema } from "../schemas/jobMetadataZod";
import type { JobMetadata } from "../schemas/jobMetadataZod";

export class JobMetadataRepository {
  private model: Model<JobMetadata>;

  constructor() {
    this.model = getJobMetadataModel();
  }

  /**
   * Create a new job metadata record
   */
  async create(jobData: Partial<JobMetadata>): Promise<{ success: boolean; jobId?: string; error?: string }> {
    try {
      const validationResult = jobMetadataZodSchema.safeParse({
        ...jobData,
        created_at: new Date(),
        updated_at: new Date()
      });

      if (!validationResult.success) {
        return {
          success: false,
          error: `Validation failed: ${validationResult.error.message}`
        };
      }

      await connect();

      const job = new this.model(validationResult.data);
      const savedJob = await job.save();

      console.log('[JobMetadataRepository] Job created:', savedJob.job_id);
      return { success: true, jobId: savedJob.job_id };
    } catch (error) {
      console.error('[JobMetadataRepository] Error creating job:', error);
      return { success: false, error: 'Failed to create job metadata' };
    }
  }

  /**
   * Find job by job_id
   */
  async findById(jobId: string): Promise<JobMetadata | null> {
    try {
      await connect();
      const job = await this.model.findOne({ job_id: jobId }).lean();
      return job;
    } catch (error) {
      console.error('[JobMetadataRepository] Error finding job:', error);
      return null;
    }
  }

  /**
   * Update job status and metadata
   */
  async updateStatus(
    jobId: string,
    updates: Partial<JobMetadata>
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await connect();

      const result = await this.model.updateOne(
        { job_id: jobId },
        { 
          $set: {
            ...updates,
            updated_at: new Date()
          }
        }
      );

      if (result.modifiedCount === 0) {
        return { success: false, error: 'Job not found or no changes made' };
      }

      return { success: true };
    } catch (error) {
      console.error('[JobMetadataRepository] Error updating job:', error);
      return { success: false, error: 'Failed to update job status' };
    }
  }

  /**
   * Find recent jobs with optional filters
   */
  async findRecent(
    limit: number = 50,
    filters?: {
      status?: string;
      uploaded_by?: string;
      s3_expired?: boolean;
    }
  ): Promise<JobMetadata[]> {
    try {
      await connect();

      const query: any = {};
      if (filters?.status) query.status = filters.status;
      if (filters?.uploaded_by) query.uploaded_by = filters.uploaded_by;
      if (filters?.s3_expired !== undefined) query.s3_expired = filters.s3_expired;

      const jobs = await this.model
        .find(query)
        .sort({ created_at: -1 })
        .limit(limit)
        .lean();

      return jobs;
    } catch (error) {
      console.error('[JobMetadataRepository] Error finding recent jobs:', error);
      return [];
    }
  }

  /**
   * Find jobs by status
   */
  async findByStatus(status: string): Promise<JobMetadata[]> {
    try {
      await connect();
      const jobs = await this.model
        .find({ status })
        .sort({ created_at: -1 })
        .lean();
      return jobs;
    } catch (error) {
      console.error('[JobMetadataRepository] Error finding jobs by status:', error);
      return [];
    }
  }

  /**
   * Find jobs by user
   */
  async findByUser(clerkUserId: string, limit: number = 100): Promise<JobMetadata[]> {
    try {
      await connect();
      const jobs = await this.model
        .find({ uploaded_by: clerkUserId })
        .sort({ created_at: -1 })
        .limit(limit)
        .lean();
      return jobs;
    } catch (error) {
      console.error('[JobMetadataRepository] Error finding jobs by user:', error);
      return [];
    }
  }

  /**
   * Mark job as S3 expired
   */
  async markS3Expired(jobId: string): Promise<{ success: boolean; error?: string }> {
    try {
      await connect();

      const result = await this.model.updateOne(
        { job_id: jobId },
        { 
          $set: { 
            s3_expired: true,
            updated_at: new Date()
          }
        }
      );

      if (result.modifiedCount === 0) {
        return { success: false, error: 'Job not found' };
      }

      console.log('[JobMetadataRepository] Marked job as S3 expired:', jobId);
      return { success: true };
    } catch (error) {
      console.error('[JobMetadataRepository] Error marking job as expired:', error);
      return { success: false, error: 'Failed to mark job as expired' };
    }
  }

  /**
   * Find jobs older than specified days (for cleanup)
   */
  async findOlderThan(days: number): Promise<JobMetadata[]> {
    try {
      await connect();
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      const jobs = await this.model
        .find({
          created_at: { $lt: cutoffDate },
          s3_expired: false
        })
        .lean();

      return jobs;
    } catch (error) {
      console.error('[JobMetadataRepository] Error finding old jobs:', error);
      return [];
    }
  }

  /**
   * Get job statistics
   */
  async getStats(): Promise<{
    total: number;
    success: number;
    failed: number;
    in_progress: number;
    expired: number;
  }> {
    try {
      await connect();

      const stats = await this.model.aggregate([
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ]);

      const expiredCount = await this.model.countDocuments({ s3_expired: true });

      const result = {
        total: 0,
        success: 0,
        failed: 0,
        in_progress: 0,
        expired: expiredCount
      };

      stats.forEach(item => {
        result.total += item.count;
        if (item._id === 'success') result.success = item.count;
        if (item._id === 'failed') result.failed = item.count;
        if (item._id === 'in_progress') result.in_progress = item.count;
      });

      return result;
    } catch (error) {
      console.error('[JobMetadataRepository] Error getting stats:', error);
      return { total: 0, success: 0, failed: 0, in_progress: 0, expired: 0 };
    }
  }
}
