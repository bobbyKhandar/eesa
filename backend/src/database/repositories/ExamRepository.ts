/**
 * Exam Repository - Exam Management Operations
 * Handles all database operations related to exams
 */

import { Types } from "mongoose";
import type { Model } from "mongoose";
import { connect } from "../connect.js";
import { getExamModel, getUserModel } from "../mongooseSchemas.js";
import type { Exam } from "../schemas/examSchemaZod.js";
import { ExamQuestionRepository } from "./ExamQuestionRepository.js";

const { ObjectId } = Types;

export class ExamRepository {
  private model: Model<Exam>;
  private examQuestionRepo: ExamQuestionRepository;

  constructor() {
    this.model = getExamModel();
    this.examQuestionRepo = new ExamQuestionRepository();
  }

  /**
   * Create exam with prompts (new schema)
   * This creates ExamQuestion instances and links them to an Exam
   */
  async createWithPrompts(examData: {
    examTitle: string;
    examDescription: string;
    subject: string;
    examDegree: string;
    examType: string;
    passingPercentage: number;
    duration?: number;
    scheduledAt?: Date;
    createdBy: string;
    instructions?: string;
    negativeMarking?: boolean;
    negativeMarkingPercentage?: number;
    assignedUsers: string[];
    questions: Array<{
      promptId: string;
      marks: number;
      negativeMarks?: number;
      questionType: 'MCQ' | 'TEXT' | 'TRUE_FALSE';
      answer: string | number[];
      options?: Array<{ text: string; isCorrect: boolean }>;
    }>;
  }): Promise<{ success: boolean; examId?: string; error?: string }> {
    try {
      await connect();

      // Step 1: Create ExamQuestion instances
      const examQuestionsData = examData.questions.map(q => ({
        promptId: q.promptId,
        options: q.options,
        marks: q.marks,
        negativeMarks: q.negativeMarks,
        questionType: q.questionType,
        answer: q.answer
      }));

      const examQuestionsResult = await this.examQuestionRepo.createBulk(examQuestionsData);
      if (!examQuestionsResult.success || !examQuestionsResult.examQuestionIds) {
        return { success: false, error: examQuestionsResult.error };
      }

      // Step 2: Calculate total marks
      const examMaxMarks = examData.questions.reduce((sum, q) => sum + q.marks, 0);

      // Step 3: Create Exam
      const examDoc: any = {
        examTitle: examData.examTitle,
        examDescription: examData.examDescription,
        subject: examData.subject,
        examDegree: examData.examDegree,
        examType: examData.examType,
        passingPercentage: examData.passingPercentage,
        examMaxMarks,
        duration: examData.duration,
        scheduledAt: examData.scheduledAt,
        createdBy: examData.createdBy,
        instructions: examData.instructions,
        negativeMarking: examData.negativeMarking || false,
        negativeMarkingPercentage: examData.negativeMarkingPercentage,
        // Store as array of strings to match schema and enable aggregation lookup
        questions: examQuestionsResult.examQuestionIds,
        assignedUsers: examData.assignedUsers,
        createdAt: new Date()
      };

      // Manually generate _id to avoid Mongoose pre-save hook issues
      examDoc._id = new Types.ObjectId();
      
      // Use insertMany to bypass pre-save hooks that cause "_id before saving" errors
      const savedExams = await this.model.insertMany([examDoc] as any);
      const savedExam = savedExams[0];
      
      // Ensure we have the _id
      if (!savedExam._id) {
        savedExam._id = examDoc._id as any;
      }

      // Step 4: Update assigned users (optional - skip if users don't exist)
      try {
        const UserModel = getUserModel();
        await UserModel.updateMany(
          { _id: { $in: examData.assignedUsers } },
          { $addToSet: { currentAllocatedExams: savedExam._id.toString() } }
        );
      } catch (userUpdateError) {
        console.warn('Could not update assigned users (they may not exist):', userUpdateError);
      }

      console.log('Exam created with prompts:', savedExam._id);
      return { success: true, examId: savedExam._id.toString() };
    } catch (error) {
      console.error('Error creating exam with prompts:', error);
      return { success: false, error: 'Failed to create exam with prompts' };
    }
  }

  /**
   * Get exam with full question details (3-level join: Exam → ExamQuestion → Prompt)
   * Used by: Student exam page, teacher preview
   */
  async getWithFullDetails(examId: string): Promise<any> {
    try {
      await connect();

      // Exam _id is stored as string in the database (see examSchemaZod.ts)
      const result = await this.model.aggregate([
        { $match: { _id: examId } },
        {
          $lookup: {
            from: 'examquestions',
            let: { questionIds: '$questions' },
            pipeline: [
              {
                $addFields: {
                  // Convert ObjectId to string for comparison
                  _idStr: { $toString: '$_id' }
                }
              },
              {
                $match: {
                  $expr: {
                    // questions array stores string IDs, so compare stringified _id with array elements
                    $in: ['$_idStr', '$$questionIds']
                  }
                }
              },
              {
                $lookup: {
                  from: 'prompts',
                  let: { promptIdStr: { $toString: '$promptId' } },
                  pipeline: [
                    { $addFields: { idStr: { $toString: '$_id' } } },
                    { $match: { $expr: { $eq: ['$idStr', '$$promptIdStr'] } } }
                  ],
                  as: 'promptData'
                }
              },
              { $unwind: '$promptData' }
            ],
            as: 'questionDetails'
          }
        }
      ]);

      return result.length > 0 ? result[0] : null;
    } catch (error) {
      console.error('Error getting exam with full details:', error);
      return null;
    }
  }

  /**
   * Assign exam to additional users
   */
  async assignToUsers(
    examId: string,
    userIds: string[]
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await connect();

      // Update exam
      await this.model.updateOne(
        { _id: examId },
        { $addToSet: { assignedUsers: { $each: userIds } } }
      );

      // Update users
      const UserModel = getUserModel();
      await UserModel.updateMany(
        { _id: { $in: userIds } },
        { $addToSet: { currentAllocatedExams: examId } }
      );

      return { success: true };
    } catch (error) {
      console.error('Error assigning exam to users:', error);
      return { success: false, error: 'Failed to assign exam to users' };
    }
  }

  /**
   * Get exam by ID
   */
  async getById(examId: string): Promise<Exam | null> {
    try {
      await connect();
      const exam = await this.model.findById(examId).lean();
      return exam;
    } catch (error) {
      console.error('Error getting exam:', error);
      return null;
    }
  }

  /**
   * Get exams by subject
   */
  async getBySubject(subjectId: string, limit: number = 50): Promise<Exam[]> {
    try {
      await connect();
      const exams = await this.model.find({ subject: subjectId })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();
      return exams;
    } catch (error) {
      console.error('Error getting exams by subject:', error);
      return [];
    }
  }

  /**
   * Get exams created by a user
   */
  async getByCreator(creatorId: string, limit: number = 50): Promise<Exam[]> {
    try {
      await connect();
      const exams = await this.model.find({ createdBy: creatorId })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();
      return exams;
    } catch (error) {
      console.error('Error getting exams by creator:', error);
      return [];
    }
  }

  /**
   * Update exam
   */
  async update(
    examId: string,
    updates: Partial<Exam>
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await connect();
      const result = await this.model.updateOne(
        { _id: examId },
        { $set: updates }
      );

      if (result.modifiedCount === 0) {
        return { success: false, error: 'Exam not found or no changes made' };
      }

      return { success: true };
    } catch (error) {
      console.error('Error updating exam:', error);
      return { success: false, error: 'Failed to update exam' };
    }
  }

  /**
   * Delete exam
   */
  async delete(examId: string): Promise<{ success: boolean; error?: string }> {
    try {
      await connect();

      const result = await this.model.deleteOne({ _id: examId });

      if (result.deletedCount === 0) {
        return { success: false, error: 'Exam not found' };
      }

      return { success: true };
    } catch (error) {
      console.error('Error deleting exam:', error);
      return { success: false, error: 'Failed to delete exam' };
    }
  }

  /**
   * Get all exams
   */
  async getAll(limit: number = 100): Promise<Exam[]> {
    try {
      await connect();
      const exams = await this.model.find({})
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();
      return exams;
    } catch (error) {
      console.error('Error getting all exams:', error);
      return [];
    }
  }
}
