import { z } from "zod";

/**
 * Prompt Schema - Central Question Library
 * 
 * This is the immutable, central prompt. It's the 'source of truth' 
 * for a question's text and origin. Questions are stored here and
 * referenced by exams, enabling reusability across multiple exams.
 */
export const promptZodSchema = z.object({
  questionText: z.string(),
  subject: z.string(), // e.g., "Biology"
  subjectCode: z.string().optional(), // e.g., "CS401"
  branch: z.string().optional(), // e.g., "IT", "Computer Engineering"
  
  // Question metadata
  questionType: z.enum(['text', 'mcq', 'Short', 'Long', 'Numerical', 'Diagram']).optional(),
  options: z.array(z.string()).optional(), // For MCQ questions only
  marks: z.string().optional(), // Marks as string (e.g., "10", "5")
  
  // Bloom's Taxonomy Classification
  bloomLevel: z.enum(['Recall', 'Understand', 'Apply', 'Analyze', 'Evaluate', 'Create']).optional(),
  bloomJustification: z.string().optional(), // Explanation of Bloom's level
  confidence: z.number().optional(), // 0.0-1.0 confidence score
  difficulty: z.enum(['Easy', 'Medium', 'Hard']).optional(),
  keywords: z.array(z.string()).default([]), // 3-5 key terms
  topicsCovered: z.array(z.string()).default([]), // 2-4 main topics
  
  // Legacy field for backward compatibility
  topic: z.string().optional(), // e.g., "Cellular Respiration"
  
  generateVia: z.enum(['llm', 'ocr', 'user', 'bedrock']).default('bedrock'),

  // Optional metadata, especially for OCR'd prompts
  source: z.string().optional(), // e.g., file location or name
  ocrConfidence: z.number().optional(),
  
  // Tracking fields
  createdBy: z.string().optional(), // User ID who created this
  createdAt: z.date().default(() => new Date()),
  
  // Similarity relationships (populated by clustering pipeline)
  similarQuestions: z.array(z.string()).default([]), // Array of Prompt IDs that are similar
  hasSimilarQuestions: z.boolean().default(false),
  clusterId: z.number().optional(), // HDBSCAN cluster ID for topic grouping
  appearanceFrequency: z.object({
    count: z.number().default(0), // How many times similar questions appeared
    years: z.array(z.number()).default([]) // Years where similar questions were asked
  }).optional(),
  
  // Legacy field (deprecated - use bloomLevel instead)
  bloomsLevel: z.enum(['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create']).optional(),
});

export type Prompt = z.infer<typeof promptZodSchema>;
