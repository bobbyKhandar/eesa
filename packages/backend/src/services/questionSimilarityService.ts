/**
 * Question Similarity Service
 * Manages bidirectional similarity relationships in MongoDB
 */

import { getPromptModel } from '../database/mongooseSchemas';
import { Types } from 'mongoose';

export interface SimilarityUpdateResult {
  success: boolean;
  questionId: string;
  similarQuestionsUpdated: number;
  error?: string;
}

/**
 * Find similar questions in MongoDB based on text similarity
 * Uses MongoDB text search and filters
 */
export async function findSimilarQuestionsInDB(
  questionText: string,
  subject: string,
  excludeIds: string[] = [],
  limit: number = 10
): Promise<string[]> {
  try {
    const PromptModel = getPromptModel();
    
    // Normalize question text for comparison
    const normalizedText = normalizeQuestionText(questionText);
    const keywords = extractKeywords(normalizedText);
    
    // Search for similar questions
    const similarQuestions = await PromptModel.find({
      subject: subject,
      _id: { $nin: excludeIds.map(id => new Types.ObjectId(id)) },
      isActive: true,
      $or: [
        // Text search on question text
        { questionText: { $regex: keywords.join('|'), $options: 'i' } },
        // Match on normalized text
        { normalizedText: { $regex: normalizedText.slice(0, 100), $options: 'i' } }
      ]
    })
    .limit(limit)
    .select('_id questionText')
    .lean();
    
    return similarQuestions.map(q => q._id.toString());
    
  } catch (error) {
    console.error('[Similarity Service] Error finding similar questions:', error);
    return [];
  }
}

/**
 * Update question with similar question IDs and update all similar questions bidirectionally
 */
export async function updateSimilarityRelationships(
  questionId: string,
  similarQuestionIds: string[]
): Promise<SimilarityUpdateResult> {
  try {
    const PromptModel = getPromptModel();
    
    if (!similarQuestionIds || similarQuestionIds.length === 0) {
      return {
        success: true,
        questionId,
        similarQuestionsUpdated: 0
      };
    }
    
    // Step 1: Update the current question with similar question IDs
    await PromptModel.findByIdAndUpdate(
      questionId,
      {
        $addToSet: {
          similarQuestions: { $each: similarQuestionIds.map(id => new Types.ObjectId(id)) }
        },
        $set: {
          hasSimilarQuestions: true
        }
      }
    );
    
    // Step 2: Update all similar questions to include this question (bidirectional)
    const updateResult = await PromptModel.updateMany(
      {
        _id: { $in: similarQuestionIds.map(id => new Types.ObjectId(id)) }
      },
      {
        $addToSet: {
          similarQuestions: new Types.ObjectId(questionId)
        },
        $set: {
          hasSimilarQuestions: true
        }
      }
    );
    
    console.log(`[Similarity Service] Updated ${questionId} with ${similarQuestionIds.length} similar questions`);
    console.log(`[Similarity Service] Updated ${updateResult.modifiedCount} similar questions bidirectionally`);
    
    return {
      success: true,
      questionId,
      similarQuestionsUpdated: updateResult.modifiedCount
    };
    
  } catch (error: any) {
    console.error('[Similarity Service] Error updating similarity relationships:', error);
    return {
      success: false,
      questionId,
      similarQuestionsUpdated: 0,
      error: error.message
    };
  }
}

/**
 * Batch update similarity relationships for multiple questions
 */
export async function batchUpdateSimilarityRelationships(
  updates: Array<{ questionId: string; similarQuestionIds: string[] }>
): Promise<SimilarityUpdateResult[]> {
  const results: SimilarityUpdateResult[] = [];
  
  for (const update of updates) {
    const result = await updateSimilarityRelationships(
      update.questionId,
      update.similarQuestionIds
    );
    results.push(result);
  }
  
  return results;
}

/**
 * Find similar questions for a newly saved prompt using text-based similarity
 * This is called after saving a prompt to MongoDB to find and link similar questions
 */
export async function findAndLinkSimilarQuestions(
  promptId: string,
  questionText: string,
  subject: string,
  excludeIds: string[] = []
): Promise<{ success: boolean; linkedCount: number }> {
  try {
    // Find similar questions by text
    const similarPromptIds = await findSimilarQuestionsInDB(
      questionText,
      subject,
      [...excludeIds, promptId], // Exclude self and provided IDs
      10 // Max 10 similar questions
    );
    
    if (similarPromptIds.length === 0) {
      return { success: true, linkedCount: 0 };
    }
    
    // Update bidirectional relationships
    const result = await updateSimilarityRelationships(promptId, similarPromptIds);
    
    console.log(`[Similarity Service] Linked ${promptId} with ${similarPromptIds.length} similar questions`);
    
    return {
      success: result.success,
      linkedCount: similarPromptIds.length
    };
    
  } catch (error) {
    console.error('[Similarity Service] Error finding and linking similar questions:', error);
    return { success: false, linkedCount: 0 };
  }
}

/**
 * @deprecated Use findAndLinkSimilarQuestions instead - questionNumber is not on Prompt schema
 * Maps question numbers from pipeline to MongoDB Prompt IDs
 */
export async function mapPipelineSimilarityToMongoDB(
  pipelineSimilarQuestionNumbers: string[],
  subject: string,
  branch?: string,
  examType?: string
): Promise<string[]> {
  console.warn('[Similarity Service] mapPipelineSimilarityToMongoDB is deprecated. Use findAndLinkSimilarQuestions instead.');
  // Return empty array since Prompt doesn't have questionNumber field
  return [];
}

/**
 * Normalize question text for comparison
 */
function normalizeQuestionText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract keywords from question text
 */
function extractKeywords(text: string, minLength: number = 4): string[] {
  const words = text.split(/\s+/);
  const stopWords = new Set(['what', 'how', 'why', 'when', 'where', 'which', 'who', 'explain', 'describe', 'define', 'with']);
  
  return words
    .filter(word => word.length >= minLength && !stopWords.has(word))
    .slice(0, 10); // Top 10 keywords
}
