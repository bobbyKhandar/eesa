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
  topic: z.string().optional(), // e.g., "Cellular Respiration"
  generateVia: z.enum(['llm', 'ocr', 'user']),

  // Optional metadata, especially for OCR'd prompts
  source: z.string().optional(), // e.g., file location or name
  ocrConfidence: z.number().optional(),
  
  // Tracking fields
  createdBy: z.string(), // User ID who created this
  createdAt: z.date().default(() => new Date()),
  
  // Educational metadata
  bloomsLevel: z.enum(['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create']).optional(),
});

export type Prompt = z.infer<typeof promptZodSchema>;
