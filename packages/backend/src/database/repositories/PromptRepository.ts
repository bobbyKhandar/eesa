/**
 * Prompt Repository - Central Question Library Operations
 * Handles all database operations related to prompts (questions in the central library)
 */

import { Types } from "mongoose";
import type { ClientSession, Model } from "mongoose";
import { connect } from "../connect.js";
import { getPromptModel } from "../mongooseSchemas.js";
import { promptZodSchema } from "../schemas/promptSchemaZod.js";
import type { Prompt } from "../schemas/promptSchemaZod.js";
import { publicPromptSubjectQuery } from "../../services/publicQuestionBank.js";
import {
  deleteInsertedIds,
  ExamCreationAborted,
  insertedIdsFromBulkError,
  isTransactionsUnsupportedError,
} from "../examWriteRollback.js";
import { nullIfAbsentId, objectIdsFrom, rethrowReadFailure } from "./readErrors.js";

export class PromptRepository {
  private model: Model<Prompt>;

  constructor() {
    this.model = getPromptModel();
  }

  /**
   * Create a new prompt in the central question library
   * Used by: OCR pipeline, LLM generator, manual question creation
   */
  async create(promptData: {
    questionText: string;
    subject: string;
    topic?: string;
    generateVia: 'llm' | 'ocr' | 'user';
    source?: string;
    ocrConfidence?: number;
    createdBy: string;
    bloomsLevel?: 'remember' | 'understand' | 'apply' | 'analyze' | 'evaluate' | 'create';
  }): Promise<{ success: boolean; promptId?: string; error?: string }> {
    try {
      // Validate input using Zod schema
      const validationResult = promptZodSchema.safeParse({
        ...promptData,
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

      const prompt = new this.model(validationResult.data);
      const savedPrompt = await prompt.save();

      console.log('Prompt created:', savedPrompt._id);
      return { success: true, promptId: savedPrompt._id.toString() };
    } catch (error) {
      console.error('Error creating prompt:', error);
      return { success: false, error: 'Failed to create prompt' };
    }
  }

  /**
   * Bulk create prompts (used by OCR batch processing)
   */
  async createBulk(promptsData: Array<{
    questionText: string;
    subject: string;
    topic?: string;
    generateVia: 'llm' | 'ocr' | 'user';
    source?: string;
    ocrConfidence?: number;
    createdBy: string;
    bloomsLevel?: 'remember' | 'understand' | 'apply' | 'analyze' | 'evaluate' | 'create';
  }>, options?: { session?: ClientSession | null }): Promise<{ success: boolean; promptIds?: string[]; error?: string }> {
    const session = options?.session ?? null;
    try {
      await connect();

      // Validate all prompts
      const validatedPrompts = promptsData.map(data => {
        const result = promptZodSchema.safeParse({
          ...data,
          _id: undefined,
          createdAt: new Date()
        });
        if (!result.success) {
          throw new Error(`Prompt validation failed: ${result.error.message}`);
        }
        return result.data;
      });

      const insertedPrompts = await this.model.insertMany(validatedPrompts, {
        ordered: true,
        ...(session ? { session } : {}),
      });
      const promptIds = insertedPrompts.map(p => p._id.toString());

      console.log(`Created ${promptIds.length} prompts in bulk`);
      return { success: true, promptIds };
    } catch (error) {
      console.error('Error creating prompts in bulk:', error);
      if (isTransactionsUnsupportedError(error)) throw error;

      const insertedIds = insertedIdsFromBulkError(error);
      const message = 'Failed to create prompts in bulk';
      if (session) {
        throw new ExamCreationAborted(message, { promptIds: insertedIds });
      }

      const leftover = await deleteInsertedIds(insertedIds, (ids) => this.deleteManyByIds(ids));
      return {
        success: false,
        error: message,
        ...(leftover.length > 0 ? { promptIds: leftover } : {}),
      };
    }
  }

  /**
   * Get a prompt by ID
   */
  async getById(promptId: string): Promise<Prompt | null> {
    try {
      await connect();
      const promptObjectId = Types.ObjectId.createFromHexString(promptId);
      const prompt = await this.model.findById(promptObjectId).lean();
      return prompt;
    } catch (error) {
      return nullIfAbsentId(error, 'Error getting prompt:');
    }
  }

  /**
   * Find prompt by ID (alias for getById for compatibility)
   */
  async findById(promptId: string): Promise<Prompt | null> {
    return this.getById(promptId);
  }

  /**
   * Find multiple prompts by their IDs
   */
  async findByIds(
    promptIds: string[],
    projection?: Readonly<Record<string, 0 | 1>>,
  ): Promise<Prompt[]> {
    try {
      await connect();
      const objectIds = objectIdsFrom(promptIds);
      if (objectIds.length === 0) return [];
      const query = this.model.find({ _id: { $in: objectIds } });
      if (projection) query.select(projection);
      return await query.lean();
    } catch (error) {
      rethrowReadFailure(error, "Error finding prompts by IDs:");
    }
  }

  /** Collection that stores prompt documents, for a bounded `$lookup`. */
  promptCollectionName(): string {
    return this.model.collection.collectionName;
  }

  /**
   * Search prompts by subject and optional filters
   * Used by: Exam creation UI, question bank browser
   */
  async search(filters: {
    subject: string;
    topic?: string;
    bloomsLevel?: string | string[];
    generateVia?: 'llm' | 'ocr' | 'user';
    minOcrConfidence?: number;
    limit?: number;
    skip?: number;
  }): Promise<Prompt[]> {
    try {
      await connect();

      const query: any = { subject: filters.subject };

      if (filters.topic) {
        query.topic = filters.topic;
      }

      if (filters.bloomsLevel) {
        query.bloomsLevel = Array.isArray(filters.bloomsLevel)
          ? { $in: filters.bloomsLevel }
          : filters.bloomsLevel;
      }

      if (filters.generateVia) {
        query.generateVia = filters.generateVia;
      }

      if (filters.minOcrConfidence !== undefined) {
        query.ocrConfidence = { $gte: filters.minOcrConfidence };
      }

      const prompts = await this.model.find(query)
        .sort({ createdAt: -1 })
        .limit(filters.limit || 50)
        .skip(filters.skip || 0)
        .lean();

      return prompts;
    } catch (error) {
      rethrowReadFailure(error, 'Error searching prompts:');
    }
  }

  /**
   * Get low confidence OCR questions for review
   * Used by: Quality control dashboard for teachers
   */
  async getLowConfidenceOcr(
    threshold: number = 0.85,
    limit: number = 20
  ): Promise<Prompt[]> {
    try {
      await connect();

      const prompts = await this.model.find({
        generateVia: 'ocr',
        ocrConfidence: { $lt: threshold }
      })
        .sort({ ocrConfidence: 1 })
        .limit(limit)
        .lean();

      return prompts;
    } catch (error) {
      rethrowReadFailure(error, 'Error getting low confidence OCR prompts:');
    }
  }

  /**
   * Update a prompt (for corrections/improvements)
   */
  async update(
    promptId: string,
    updates: Partial<Prompt>
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await connect();
      const promptObjectId = Types.ObjectId.createFromHexString(promptId);

      const result = await this.model.updateOne(
        { _id: promptObjectId },
        { $set: updates }
      );

      if (result.modifiedCount === 0) {
        return { success: false, error: 'Prompt not found or no changes made' };
      }

      return { success: true };
    } catch (error) {
      console.error('Error updating prompt:', error);
      return { success: false, error: 'Failed to update prompt' };
    }
  }

  /**
   * Get prompts by source (for PYQ tracking)
   */
  async getBySource(source: string): Promise<Prompt[]> {
    try {
      await connect();
      const prompts = await this.model.find({ source }).lean();
      return prompts;
    } catch (error) {
      rethrowReadFailure(error, 'Error getting prompts by source:');
    }
  }

  /**
   * Delete many prompts by ID, ignoring ids that are not ObjectIds.
   * Returns how many documents were removed.
   */
  async deleteManyByIds(promptIds: string[]): Promise<number> {
    if (promptIds.length === 0) return 0;

    try {
      await connect();
      const objectIds = promptIds
        .map((id) => (Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : null))
        .filter((id): id is Types.ObjectId => id !== null);

      if (objectIds.length === 0) return 0;

      const result = await this.model.deleteMany({ _id: { $in: objectIds } });
      return result.deletedCount ?? 0;
    } catch (error) {
      console.error('Error deleting prompts:', error);
      return 0;
    }
  }

  /**
   * Delete a prompt (cascade check recommended)
   */
  async delete(promptId: string): Promise<{ success: boolean; error?: string }> {
    try {
      await connect();
      const promptObjectId = Types.ObjectId.createFromHexString(promptId);

      const result = await this.model.deleteOne({ _id: promptObjectId });

      if (result.deletedCount === 0) {
        return { success: false, error: 'Prompt not found' };
      }

      return { success: true };
    } catch (error) {
      console.error('Error deleting prompt:', error);
      return { success: false, error: 'Failed to delete prompt' };
    }
  }

  /**
   * Get count of prompts by generate via
   */
  async getCountBySource(): Promise<{ ocr: number; llm: number; user: number }> {
    try {
      await connect();
      
      const counts = await this.model.aggregate([
        {
          $group: {
            _id: '$generateVia',
            count: { $sum: 1 }
          }
        }
      ]);

      const result = { ocr: 0, llm: 0, user: 0 };
      counts.forEach(item => {
        if (item._id in result) {
          result[item._id as keyof typeof result] = item.count;
        }
      });

      return result;
    } catch (error) {
      rethrowReadFailure(error, 'Error getting prompt counts:');
    }
  }

  /**
   * Prompts for a subject that are safe to show on the public question bank.
   * Exam creation stores unpublished prompts in this collection with
   * generateVia "user"; those are excluded. Used by the unique-questions fallback.
   */
  async findBySubject(subject: string): Promise<Prompt[]> {
    try {
      await connect();
      return await this.model.find(publicPromptSubjectQuery(subject)).lean();
    } catch (error) {
      rethrowReadFailure(error, 'Error finding prompts by subject:');
    }
  }
}
