/**
 * Exam Repository - Exam Management Operations
 * Handles all database operations related to exams
 */

import { Types } from "mongoose";
import type { Model } from "mongoose";
import { connect } from "../connect.js";
import { getExamModel, getUserModel } from "../mongooseSchemas.js";
import type { Exam } from "../schemas/examSchemaZod.js";
import { activeExamQuery } from "../examDeletion.js";
import { orderQuestionDetails } from "../questionOrder.js";
import { ExamQuestionRepository } from "./ExamQuestionRepository.js";
import { nullIfAbsentId, objectIdsFrom, rethrowReadFailure } from "./readErrors.js";

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
   * Get exam with full question details (3-level join: Exam → ExamQuestion → Prompt).
   * questionDetails follows the exam's questions array. The $in lookup does not.
   * Still returns a soft-deleted exam so saved submissions can be opened.
   * Used by: Student exam page, teacher preview, submission review
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
              { $unwind: '$promptData' },
              // `$in` does not keep exam.questions order. Sort by that index,
              // then drop the helper so it is not part of the joined question.
              {
                $addFields: {
                  _authoredOrder: { $indexOfArray: ['$$questionIds', '$_idStr'] }
                }
              },
              { $sort: { _authoredOrder: 1 } },
              { $unset: '_authoredOrder' }
            ],
            as: 'questionDetails'
          }
        }
      ]);

      const exam = result.length > 0 ? result[0] : null;
      if (!exam) return null;
      // `$sort` inside `$lookup` is not guaranteed to stick in the output array.
      // Restore the authored sequence again before any caller renders it.
      exam.questionDetails = orderQuestionDetails(exam.questions, exam.questionDetails);
      return exam;
    } catch (error) {
      return nullIfAbsentId(error, 'Error getting exam with full details:');
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
      return nullIfAbsentId(error, 'Error getting exam:');
    }
  }

  /**
   * Get exams by IDs in a single query, preserving the order of `examIds`.
   * Ids without a matching exam are skipped.
   */
  async getByIds(examIds: string[]): Promise<Exam[]> {
    try {
      await connect();
      const uniqueIds = Array.from(
        new Set(examIds.filter((id) => typeof id === 'string' && id.length > 0))
      );
      if (uniqueIds.length === 0) return [];

      const exams = await this.model.find(activeExamQuery({ _id: { $in: uniqueIds } })).lean();
      const examsById = new Map<string, Exam>(exams.map((exam) => [String(exam._id), exam]));

      return uniqueIds
        .map((id) => examsById.get(id))
        .filter((exam): exam is Exam => exam !== undefined);
    } catch (error) {
      rethrowReadFailure(error, 'Error getting exams by ids:');
    }
  }

  /**
   * Load the exams referenced by saved submissions in one `$in` query.
   * Soft-deleted exams are included: a result still names the exam that was taken.
   * Ids that cannot name a document are skipped. An empty list does not query.
   */
  async getHistoricalByIds(examIds: string[]): Promise<Exam[]> {
    try {
      await connect();
      const uniqueIds = Array.from(
        new Set(examIds.filter((id) => typeof id === 'string' && id.length > 0))
      );
      const objectIds = objectIdsFrom(uniqueIds);
      if (objectIds.length === 0) return [];

      const exams = await this.model.find({ _id: { $in: objectIds } }).lean();
      return exams;
    } catch (error) {
      rethrowReadFailure(error, 'Error getting exams for result history:');
    }
  }

  /**
   * Get exams by subject
   */
  async getBySubject(subjectId: string, limit: number = 50): Promise<Exam[]> {
    try {
      await connect();
      const exams = await this.model.find(activeExamQuery({ subject: subjectId }))
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();
      return exams;
    } catch (error) {
      rethrowReadFailure(error, 'Error getting exams by subject:');
    }
  }

  /**
   * Get exams created by a user
   */
  async getByCreator(creatorId: string, limit: number = 50): Promise<Exam[]> {
    try {
      await connect();
      const exams = await this.model.find(activeExamQuery({ createdBy: creatorId }))
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();
      return exams;
    } catch (error) {
      rethrowReadFailure(error, 'Error getting exams by creator:');
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
   * Soft-delete an exam. The exam and its ExamQuestion rows stay so saved
   * submissions can still join the title, prompts, and marks. The exam is
   * removed from every user's allocation and hidden from listings and attempts.
   */
  async delete(examId: string): Promise<{ success: boolean; error?: string }> {
    try {
      await connect();

      const existing = await this.model.findById(examId).select('_id').lean();
      if (!existing) {
        return { success: false, error: 'Exam not found' };
      }

      const result = await this.model.updateOne(
        { _id: examId },
        { $set: { deletedAt: new Date() } }
      );
      if (result.matchedCount === 0) {
        return { success: false, error: 'Exam not found' };
      }

      // Allocation cleanup is best-effort. Listing queries also exclude
      // deletedAt, so a failed pull cannot put the exam back on a student list.
      try {
        const UserModel = getUserModel();
        await UserModel.updateMany(
          { currentAllocatedExams: examId },
          { $pull: { currentAllocatedExams: examId } }
        );
      } catch (userUpdateError) {
        console.warn('Could not clear exam from user allocations:', userUpdateError);
      }

      console.log(`Exam ${examId} soft-deleted`);
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
      const exams = await this.model.find(activeExamQuery())
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();
      return exams;
    } catch (error) {
      rethrowReadFailure(error, 'Error getting all exams:');
    }
  }
}
