/**
 * Prompt Repository - Central Question Library Operations
 * Handles all database operations related to prompts (questions in the central library)
 */

import { Types } from "mongoose";
import type { Model } from "mongoose";
import { connect } from "../connect.js";
import { getPromptModel } from "../mongooseSchemas.js";
import { promptZodSchema } from "../schemas/promptSchemaZod.js";
import type { Prompt } from "../schemas/promptSchemaZod.js";

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
  }>): Promise<{ success: boolean; promptIds?: string[]; error?: string }> {
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

      const insertedPrompts = await this.model.insertMany(validatedPrompts);
      const promptIds = insertedPrompts.map(p => p._id.toString());

      console.log(`Created ${promptIds.length} prompts in bulk`);
      return { success: true, promptIds };
    } catch (error) {
      console.error('Error creating prompts in bulk:', error);
      return { success: false, error: 'Failed to create prompts in bulk' };
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
      console.error('Error getting prompt:', error);
      return null;
    }
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
      console.error('Error searching prompts:', error);
      return [];
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
      console.error('Error getting low confidence OCR prompts:', error);
      return [];
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
      console.error('Error getting prompts by source:', error);
      return [];
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
      console.error('Error getting prompt counts:', error);
      return { ocr: 0, llm: 0, user: 0 };
    }
  }
}
