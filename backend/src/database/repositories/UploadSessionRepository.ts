/**
 * UploadSession Repository - User Upload Session Operations
 * Handles all database operations for upload sessions
 */

import { Types } from "mongoose";
import type { Model } from "mongoose";
import { connect } from "../connect";
import { getUploadSessionModel } from "../mongooseSchemas";
import { uploadSessionZodSchema } from "../schemas/uploadSessionZod";
import type { UploadSession } from "../schemas/uploadSessionZod";

export class UploadSessionRepository {
  private model: Model<UploadSession>;

  constructor() {
    this.model = getUploadSessionModel();
  }

  /**
   * Create a new upload session
   */
  async create(sessionData: Partial<UploadSession>): Promise<{ success: boolean; sessionId?: string; error?: string }> {
    try {
      const validationResult = uploadSessionZodSchema.safeParse({
        ...sessionData,
        created_at: new Date(),
        last_accessed_at: new Date()
      });

      if (!validationResult.success) {
        return {
          success: false,
          error: `Validation failed: ${validationResult.error.message}`
        };
      }

      await connect();

      const session = new this.model(validationResult.data);
      const savedSession = await session.save();

      console.log('[UploadSessionRepository] Session created:', savedSession.session_id);
      return { success: true, sessionId: savedSession.session_id };
    } catch (error) {
      console.error('[UploadSessionRepository] Error creating session:', error);
      return { success: false, error: 'Failed to create upload session' };
    }
  }

  /**
   * Find session by session_id
   */
  async findById(sessionId: string): Promise<UploadSession | null> {
    try {
      await connect();
      const session = await this.model.findOne({ session_id: sessionId }).lean();
      
      // Update last accessed timestamp
      if (session) {
        await this.model.updateOne(
          { session_id: sessionId },
          { $set: { last_accessed_at: new Date() } }
        );
      }
      
      return session;
    } catch (error) {
      console.error('[UploadSessionRepository] Error finding session:', error);
      return null;
    }
  }

  /**
   * Find all sessions for a user
   */
  async findByClerkUserId(clerkUserId: string, activeOnly: boolean = false): Promise<UploadSession[]> {
    try {
      await connect();
      
      const query: any = { clerk_user_id: clerkUserId };
      if (activeOnly) query.is_active = true;

      const sessions = await this.model
        .find(query)
        .sort({ last_accessed_at: -1 })
        .lean();

      return sessions;
    } catch (error) {
      console.error('[UploadSessionRepository] Error finding sessions by user:', error);
      return [];
    }
  }

  /**
   * Add jobs to existing session
   */
  async addJobs(
    sessionId: string,
    jobIds: string[]
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await connect();

      const result = await this.model.updateOne(
        { session_id: sessionId },
        { 
          $push: { job_ids: { $each: jobIds } },
          $inc: { 
            total_jobs: jobIds.length,
            in_progress_jobs: jobIds.length
          },
          $set: { last_accessed_at: new Date() }
        }
      );

      if (result.modifiedCount === 0) {
        return { success: false, error: 'Session not found' };
      }

      return { success: true };
    } catch (error) {
      console.error('[UploadSessionRepository] Error adding jobs:', error);
      return { success: false, error: 'Failed to add jobs to session' };
    }
  }

  /**
   * Update session stats based on job status changes
   */
  async updateJobStats(
    sessionId: string,
    statsUpdate: {
      completed_jobs?: number;
      failed_jobs?: number;
      in_progress_jobs?: number;
    }
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await connect();

      const updateObj: any = { last_accessed_at: new Date() };
      
      if (statsUpdate.completed_jobs !== undefined) {
        updateObj.completed_jobs = statsUpdate.completed_jobs;
      }
      if (statsUpdate.failed_jobs !== undefined) {
        updateObj.failed_jobs = statsUpdate.failed_jobs;
      }
      if (statsUpdate.in_progress_jobs !== undefined) {
        updateObj.in_progress_jobs = statsUpdate.in_progress_jobs;
      }

      // If all jobs are done, mark session as completed
      const session = await this.model.findOne({ session_id: sessionId });
      if (session && 
          statsUpdate.completed_jobs !== undefined && 
          statsUpdate.failed_jobs !== undefined &&
          statsUpdate.in_progress_jobs === 0) {
        if (statsUpdate.completed_jobs + statsUpdate.failed_jobs === session.total_jobs) {
          updateObj.completed_at = new Date();
        }
      }

      const result = await this.model.updateOne(
        { session_id: sessionId },
        { $set: updateObj }
      );

      if (result.modifiedCount === 0) {
        return { success: false, error: 'Session not found or no changes made' };
      }

      return { success: true };
    } catch (error) {
      console.error('[UploadSessionRepository] Error updating job stats:', error);
      return { success: false, error: 'Failed to update session stats' };
    }
  }

  /**
   * Mark session as inactive (closed)
   */
  async deactivate(sessionId: string): Promise<{ success: boolean; error?: string }> {
    try {
      await connect();

      const result = await this.model.updateOne(
        { session_id: sessionId },
        { $set: { is_active: false, last_accessed_at: new Date() } }
      );

      if (result.modifiedCount === 0) {
        return { success: false, error: 'Session not found' };
      }

      return { success: true };
    } catch (error) {
      console.error('[UploadSessionRepository] Error deactivating session:', error);
      return { success: false, error: 'Failed to deactivate session' };
    }
  }

  /**
   * Delete session
   */
  async delete(sessionId: string): Promise<{ success: boolean; error?: string }> {
    try {
      await connect();

      const result = await this.model.deleteOne({ session_id: sessionId });

      if (result.deletedCount === 0) {
        return { success: false, error: 'Session not found' };
      }

      console.log('[UploadSessionRepository] Session deleted:', sessionId);
      return { success: true };
    } catch (error) {
      console.error('[UploadSessionRepository] Error deleting session:', error);
      return { success: false, error: 'Failed to delete session' };
    }
  }

  /**
   * Delete old sessions (cleanup)
   */
  async deleteOlderThan(days: number): Promise<{ success: boolean; deletedCount: number; error?: string }> {
    try {
      await connect();
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      const result = await this.model.deleteMany({
        last_accessed_at: { $lt: cutoffDate },
        is_active: false // Only delete inactive sessions
      });

      console.log(`[UploadSessionRepository] Deleted ${result.deletedCount} old sessions`);
      return { success: true, deletedCount: result.deletedCount };
    } catch (error) {
      console.error('[UploadSessionRepository] Error deleting old sessions:', error);
      return { success: false, deletedCount: 0, error: 'Failed to delete old sessions' };
    }
  }
}
