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

      // Create submission document with manual ObjectId
      const submissionDoc: any = {
        ...data,
        submittedAt: new Date(),
        emailSent: false
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
      console.error('Error creating exam submission:', error);
      return { success: false, error: 'Failed to create exam submission' };
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
  async getById(submissionId: string): Promise<ExamSubmissionDocument | null> {
    try {
      await connect();
      const submissionObjectId = Types.ObjectId.createFromHexString(submissionId);
      const submission = await this.model.findById(submissionObjectId).lean();
      return submission;
    } catch (error) {
      console.error('Error getting submission:', error);
      return null;
    }
  }

  /**
   * Get all submissions for an exam
   */
  async getByExam(examId: string): Promise<ExamSubmissionDocument[]> {
    try {
      await connect();
      const submissions = await this.model.find({ examId })
        .sort({ submittedAt: -1 })
        .lean();
      return submissions;
    } catch (error) {
      console.error('Error getting submissions by exam:', error);
      return [];
    }
  }

  /**
   * Get user's submission history
   */
  async getByUser(userId: string): Promise<ExamSubmissionDocument[]> {
    try {
      await connect();
      const submissions = await this.model.find({ userId })
        .sort({ submittedAt: -1 })
        .lean();
      return submissions;
    } catch (error) {
      console.error('Error getting user submissions:', error);
      return [];
    }
  }

  /**
   * Get submission by exam and user
   */
  async getByExamAndUser(examId: string, userId: string): Promise<ExamSubmissionDocument | null> {
    try {
      await connect();
      const submission = await this.model.findOne({ examId, userId }).lean();
      return submission;
    } catch (error) {
      console.error('Error getting submission by exam and user:', error);
      return null;
    }
  }

  /**
   * Get submissions with scores in range
   */
  async getByScoreRange(minMarks: number, maxMarks: number): Promise<ExamSubmissionDocument[]> {
    try {
      await connect();
      const submissions = await this.model.find({
        marksAchieved: { $gte: minMarks, $lte: maxMarks }
      })
      .sort({ marksAchieved: -1 })
      .lean();
      return submissions;
    } catch (error) {
      console.error('Error getting submissions by score range:', error);
      return [];
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
