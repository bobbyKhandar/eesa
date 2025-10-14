/**
 * ExamQuestion Repository - Exam-specific Question Instance Operations
 * Handles all database operations related to exam questions (exam-specific configurations)
 */

import { Types } from "mongoose";
import type { Model } from "mongoose";
import { connect } from "../connect.js";
import { getExamQuestionModel, getExamModel } from "../mongooseSchemas.js";
import { examQuestionZodSchema } from "../schemas/examQuestionSchemaZod.js";
import type { ExamQuestion } from "../schemas/examQuestionSchemaZod.js";

export class ExamQuestionRepository {
  private model: Model<ExamQuestion>;

  constructor() {
    this.model = getExamQuestionModel();
  }

  /**
   * Create an exam question instance
   * Used by: Exam creation flow
   */
  async create(examQuestionData: {
    promptId: string;
    options?: Array<{ text: string; isCorrect: boolean }>;
    marks: number;
    negativeMarks?: number;
    questionType: 'MCQ' | 'TEXT' | 'TRUE_FALSE';
  }): Promise<{ success: boolean; examQuestionId?: string; error?: string }> {
    try {
      // Validate input
      const validationResult = examQuestionZodSchema.safeParse({
        ...examQuestionData,
        _id: undefined,
        createdAt: new Date()
      });

      if (!validationResult.success) {
        return {
          success: false,
          error: `Validation failed: ${validationResult.error.message}`
        };
      }

      await connect();

      const examQuestion = new this.model(validationResult.data);
      const savedExamQuestion = await examQuestion.save();

      console.log('ExamQuestion created:', savedExamQuestion._id);
      return { success: true, examQuestionId: savedExamQuestion._id.toString() };
    } catch (error) {
      console.error('Error creating exam question:', error);
      return { success: false, error: 'Failed to create exam question' };
    }
  }

  /**
   * Bulk create exam questions
   * Used by: Exam creation with multiple questions
   */
  async createBulk(
    examQuestionsData: Array<{
      promptId: string;
      options?: Array<{ text: string; isCorrect: boolean }>;
      marks: number;
      negativeMarks?: number;
      questionType: 'MCQ' | 'TEXT' | 'TRUE_FALSE';
    }>
  ): Promise<{ success: boolean; examQuestionIds?: string[]; error?: string }> {
    try {
      await connect();

      // Validate all exam questions
      const validatedExamQuestions = examQuestionsData.map(data => {
        const result = examQuestionZodSchema.safeParse({
          ...data,
          _id: undefined,
          createdAt: new Date()
        });
        if (!result.success) {
          throw new Error(`ExamQuestion validation failed: ${result.error.message}`);
        }
        return result.data;
      });

      const insertedExamQuestions = await this.model.insertMany(validatedExamQuestions);
      const examQuestionIds = insertedExamQuestions.map(eq => eq._id.toString());

      console.log(`Created ${examQuestionIds.length} exam questions in bulk`);
      return { success: true, examQuestionIds };
    } catch (error) {
      console.error('Error creating exam questions in bulk:', error);
      return { success: false, error: 'Failed to create exam questions in bulk' };
    }
  }

  /**
   * Get exam question with populated prompt details
   * Used by: Exam taking UI, exam preview
   */
  async getWithPrompt(examQuestionId: string): Promise<any> {
    try {
      await connect();
      const examQuestionObjectId = Types.ObjectId.createFromHexString(examQuestionId);

      const result = await this.model.aggregate([
        { $match: { _id: examQuestionObjectId } },
        {
          $lookup: {
            from: 'prompts',
            let: { promptIdStr: { $toString: '$promptId' } },
            pipeline: [
              { $addFields: { idStr: { $toString: '$_id' } } },
              { $match: { $expr: { $eq: ['$idStr', '$$promptIdStr'] } } }
            ],
            as: 'promptDetails'
          }
        },
        { $unwind: '$promptDetails' }
      ]);

      return result.length > 0 ? result[0] : null;
    } catch (error) {
      console.error('Error getting exam question with prompt:', error);
      return null;
    }
  }

  /**
   * Get multiple exam questions with prompt details (for full exam)
   */
  async getManyWithPrompts(examQuestionIds: string[]): Promise<any[]> {
    try {
      await connect();
      const examQuestionObjectIds = examQuestionIds.map(id => 
        Types.ObjectId.createFromHexString(id)
      );

      const results = await this.model.aggregate([
        { $match: { _id: { $in: examQuestionObjectIds } } },
        {
          $lookup: {
            from: 'prompts',
            let: { promptIdStr: { $toString: '$promptId' } },
            pipeline: [
              { $addFields: { idStr: { $toString: '$_id' } } },
              { $match: { $expr: { $eq: ['$idStr', '$$promptIdStr'] } } }
            ],
            as: 'promptDetails'
          }
        },
        { $unwind: '$promptDetails' }
      ]);

      return results;
    } catch (error) {
      console.error('Error getting exam questions with prompts:', error);
      return [];
    }
  }

  /**
   * Find all exams using a specific prompt
   * Used by: Impact analysis when editing prompts
   */
  async getExamsUsingPrompt(promptId: string): Promise<string[]> {
    try {
      await connect();

      // Find all ExamQuestions that reference this prompt
      const examQuestions = await this.model.find({ promptId }).select('_id').lean();
      const examQuestionIds = examQuestions.map(eq => eq._id.toString());

      if (examQuestionIds.length === 0) {
        return [];
      }

      // Find all Exams that reference these ExamQuestions
      const ExamModel = getExamModel();
      const exams = await ExamModel.find({
        questions: { $in: examQuestionIds }
      }).select('_id examTitle').lean();

      return exams.map(e => e._id.toString());
    } catch (error) {
      console.error('Error finding exams using prompt:', error);
      return [];
    }
  }

  /**
   * Get exam question by ID
   */
  async getById(examQuestionId: string): Promise<ExamQuestion | null> {
    try {
      await connect();
      const examQuestionObjectId = Types.ObjectId.createFromHexString(examQuestionId);
      const examQuestion = await this.model.findById(examQuestionObjectId).lean();
      return examQuestion;
    } catch (error) {
      console.error('Error getting exam question:', error);
      return null;
    }
  }

  /**
   * Delete exam question
   */
  async delete(examQuestionId: string): Promise<{ success: boolean; error?: string }> {
    try {
      await connect();
      const examQuestionObjectId = Types.ObjectId.createFromHexString(examQuestionId);

      const result = await this.model.deleteOne({ _id: examQuestionObjectId });

      if (result.deletedCount === 0) {
        return { success: false, error: 'Exam question not found' };
      }

      return { success: true };
    } catch (error) {
      console.error('Error deleting exam question:', error);
      return { success: false, error: 'Failed to delete exam question' };
    }
  }
}
