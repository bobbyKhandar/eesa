/**
 * ExamSubmission Repository - Exam Submission Operations
 * Handles all database operations related to COMPLETED exam submissions
 * 
 * IMPORTANT: This repository only handles SUBMITTED exams.
 * Draft/in-progress exam attempts should be handled separately.
 */

import { Types } from "mongoose";
import type { Model } from "mongoose";
import { connect } from "../connect.js";
import { getExamSubmissionModel, getUserModel } from "../mongooseSchemas.js";
import type { ExamSubmissionDocument } from "../schemas/examSubmissionZod.js";
import { nullIfAbsentId, rethrowReadFailure } from "./readErrors.js";
import {
  claimSubmissionSlot,
  gradedSubmissionFilter,
  gradedSubmissionUpdate,
  isDuplicateKeyError,
  isVisibleSubmission,
  pendingClaimFilter,
  type ClaimOutcome,
  type GradedExamSubmission,
} from "../../services/examSubmissionClaim.js";

/** Lean Mongo rows include `_id`, which the Zod document schema does not describe. */
type StoredExamSubmission = ExamSubmissionDocument & { _id: { toString(): string } };

export class ExamSubmissionRepository {
  private model: Model<ExamSubmissionDocument>;

  constructor() {
    this.model = getExamSubmissionModel();
  }

  /**
   * Create a completed exam submission
   * ALL fields including scores are MANDATORY
   */
  async create(data: {
    examId: string;
    userId: string;
    timeSpent: number;
    autoSubmitted?: boolean;
    /** Ignored: the repository stamps `submittedAt` itself when the row is written. */
    submittedAt?: Date;
    maxMarks: number;
    marksAchieved: number;
    evaluatorObservations?: string;
    responses: Array<{
      questionId: string;
      userResponse: string;
      maxMarks: number;
      allottedMarks: number;
      feedback?: string;
      suggestions?: string[];
    }>;
  }): Promise<{ success: boolean; submissionId?: string; error?: string }> {
    try {
      await connect();

      // Check if submission already exists
      const existingSubmission = await this.model.findOne({
        examId: data.examId,
        userId: data.userId
      });

      if (existingSubmission) {
        return {
          success: false,
          error: 'Exam submission already exists for this user and exam',
          submissionId: existingSubmission._id.toString()
        };
      }

      // Create submission document with manual ObjectId.
      // Direct creates are already graded, so they are complete rather than a claim.
      const submissionDoc: any = {
        ...data,
        submittedAt: new Date(),
        emailSent: false,
        gradingStatus: "complete",
      };
      submissionDoc._id = new Types.ObjectId();

      const saved = await this.model.insertMany([submissionDoc]);
      const submissionId = saved[0]._id.toString();
      
      console.log('Exam submission created:', submissionId);

      // Update user's submission history
      const UserModel = getUserModel();
      await UserModel.updateOne(
        { _id: data.userId },
        {
          $pull: { currentAllocatedExams: data.examId },
          $addToSet: { submissionHistory: submissionId }
        }
      );

      return { success: true, submissionId };
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        try {
          const existingSubmission = await this.model.findOne({
            examId: data.examId,
            userId: data.userId,
          });
          return {
            success: false,
            error: 'Exam submission already exists for this user and exam',
            ...(existingSubmission ? { submissionId: existingSubmission._id.toString() } : {}),
          };
        } catch (lookupError) {
          console.error('Error reading submission after duplicate key:', lookupError);
          return {
            success: false,
            error: 'Exam submission already exists for this user and exam',
          };
        }
      }
      console.error('Error creating exam submission:', error);
      return { success: false, error: 'Failed to create exam submission' };
    }
  }

  /**
   * Reserve the one submission for this user and exam before grading.
   * The unique (examId, userId) index makes the insert the lock. Placeholder
   * scores are replaced by `completePending` and are not a result.
   */
  async claimPending(data: {
    examId: string;
    userId: string;
    timeSpent: number;
    autoSubmitted?: boolean;
  }): Promise<ClaimOutcome> {
    try {
      await connect();
      const submittedAt = new Date();
      return await claimSubmissionSlot({
        insertPending: async () => {
          const submissionId = new Types.ObjectId();
          const pendingDoc: any = {
            _id: submissionId,
            examId: data.examId,
            userId: data.userId,
            submittedAt,
            timeSpent: data.timeSpent,
            autoSubmitted: data.autoSubmitted ?? false,
            maxMarks: 0,
            marksAchieved: 0,
            responses: [],
            emailSent: false,
            gradingStatus: "pending",
          };
          await this.model.insertMany([pendingDoc]);
          return submissionId.toString();
        },
        findByExamAndUser: async () => {
          const existing = await this.model.findOne({ examId: data.examId, userId: data.userId }).lean();
          return existing;
        },
      });
    } catch (error) {
      console.error('Error claiming exam submission:', error);
      return { status: "failed", error: "Failed to claim exam submission" };
    }
  }

  /**
   * Store the grade on the pending claim. Does not unset `answers`.
   * User history is updated only after the row is complete.
   */
  async completePending(
    submissionId: string,
    data: {
      examId: string;
      userId: string;
    } & GradedExamSubmission,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await connect();
      const submissionObjectId = Types.ObjectId.createFromHexString(submissionId);
      const result = await this.model.updateOne(
        pendingClaimFilter(submissionObjectId),
        gradedSubmissionUpdate(data),
      );
      if (result.matchedCount === 0) {
        return { success: false, error: "Pending submission was not found" };
      }

      try {
        const UserModel = getUserModel();
        await UserModel.updateOne(
          { _id: data.userId },
          {
            $pull: { currentAllocatedExams: data.examId },
            $addToSet: { submissionHistory: submissionId },
          },
        );
      } catch (historyError) {
        console.error('Error updating user after submission claim completed:', historyError);
      }

      return { success: true };
    } catch (error) {
      console.error('Error completing exam submission:', error);
      return { success: false, error: 'Failed to create exam submission' };
    }
  }

  /**
   * Delete a claim that never finished grading. A completed row is left alone,
   * including any legacy `answers` map stored on it.
   */
  async releasePending(submissionId: string): Promise<void> {
    try {
      await connect();
      const submissionObjectId = Types.ObjectId.createFromHexString(submissionId);
      await this.model.deleteOne(pendingClaimFilter(submissionObjectId));
    } catch (error) {
      console.error('Error releasing exam submission claim:', error);
    }
  }

  /**
   * Update submission responses (for re-evaluation)
   */
  async updateResponses(
    submissionId: string,
    responses: Array<{
      questionId: string;
      maxMarks?: number;
      allottedMarks: number;
      feedback?: string;
      suggestions?: string[];
    }>,
    marksAchieved: number,
    evaluatorObservations?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await connect();

      const submission = await this.model.findById(submissionId);
      if (!submission) {
        return { success: false, error: 'Submission not found' };
      }

      // Update responses with new marks and feedback
      const updatedResponses = submission.responses.map(response => {
        const update = responses.find(r => r.questionId === response.questionId);
        if (update) {
          return {
            ...response,
            maxMarks: update.maxMarks !== undefined ? update.maxMarks : response.maxMarks,
            allottedMarks: update.allottedMarks,
            feedback: update.feedback,
            suggestions: update.suggestions
          };
        }
        return response;
      });

      await this.model.updateOne(
        { _id: submissionId },
        {
          $set: {
            marksAchieved,
            evaluatorObservations,
            responses: updatedResponses
          }
        }
      );

      return { success: true };
    } catch (error) {
      console.error('Error updating submission responses:', error);
      return { success: false, error: 'Failed to update submission responses' };
    }
  }

  /**
   * Get submission by ID
   */
  async getById(submissionId: string): Promise<StoredExamSubmission | null> {
    try {
      await connect();
      const submissionObjectId = Types.ObjectId.createFromHexString(submissionId);
      const submission = await this.model.findById(submissionObjectId).lean();
      if (!submission || !isVisibleSubmission(submission)) return null;
      return submission as StoredExamSubmission | null;
    } catch (error) {
      return nullIfAbsentId(error, 'Error getting submission:');
    }
  }

  /**
   * Get all submissions for an exam
   */
  async getByExam(examId: string): Promise<ExamSubmissionDocument[]> {
    try {
      await connect();
      const submissions = await this.model.find(gradedSubmissionFilter({ examId }))
        .sort({ submittedAt: -1 })
        .lean();
      return submissions;
    } catch (error) {
      rethrowReadFailure(error, 'Error getting submissions by exam:');
    }
  }

  /**
   * Get user's submission history
   */
  async getByUser(userId: string): Promise<ExamSubmissionDocument[]> {
    try {
      await connect();
      const submissions = await this.model.find(gradedSubmissionFilter({ userId }))
        .sort({ submittedAt: -1 })
        .lean();
      return submissions;
    } catch (error) {
      rethrowReadFailure(error, 'Error getting user submissions:');
    }
  }

  /**
   * Get submission by exam and user
   */
  async getByExamAndUser(examId: string, userId: string): Promise<StoredExamSubmission | null> {
    try {
      await connect();
      const submission = await this.model.findOne({ examId, userId }).lean();
      return submission as StoredExamSubmission | null;
    } catch (error) {
      return nullIfAbsentId(error, 'Error getting submission by exam and user:');
    }
  }

  /**
   * Get submissions with scores in range
   */
  async getByScoreRange(minMarks: number, maxMarks: number): Promise<ExamSubmissionDocument[]> {
    try {
      await connect();
      const submissions = await this.model.find(gradedSubmissionFilter({
        marksAchieved: { $gte: minMarks, $lte: maxMarks }
      }))
      .sort({ marksAchieved: -1 })
      .lean();
      return submissions;
    } catch (error) {
      rethrowReadFailure(error, 'Error getting submissions by score range:');
    }
  }

  /**
   * Delete submission
   */
  async delete(submissionId: string): Promise<{ success: boolean; error?: string }> {
    try {
      await connect();
      const submissionObjectId = Types.ObjectId.createFromHexString(submissionId);

      const result = await this.model.deleteOne({ _id: submissionObjectId });

      if (result.deletedCount === 0) {
        return { success: false, error: 'Submission not found' };
      }

      return { success: true };
    } catch (error) {
      console.error('Error deleting submission:', error);
      return { success: false, error: 'Failed to delete submission' };
    }
  }
}
