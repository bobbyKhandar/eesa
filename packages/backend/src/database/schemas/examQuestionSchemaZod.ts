import { z } from "zod";

/**
 * Exam Question Schema
 * 
 * This is a user's configured INSTANCE of a prompt for use within a single exam. 
 * It adds the context like marks, options, and answers.
 * 
 * The promptId field links back to the central Prompt collection.
 */
export const examQuestionZodSchema = z.object({
  // Note: 'promptId' links back to the central PromptSchema
  promptId: z.string(),
  questionType: z.enum(['MCQ', 'TEXT', 'TRUE_FALSE']),

  // Array of objects is best practice for options
  options: z
    .array(
      z.object({
        text: z.string(),
        // isCorrect is useful for auto-grading MCQs
        isCorrect: z.boolean(),
      })
    )
    .optional(),

  // Can be a sample answer or rubric for TEXT questions
  // For MCQs: array of correct option indices
  // Note: Using z.any() to allow both string and array types
  // Must be optional without default to avoid @zodyac/zod-mongoose validation bug
  answer: z.any().optional(),
  
  marks: z.number(),
  negativeMarking: z.number().optional(), // For MCQs
  tags: z.array(z.string()).optional(),
});

export type ExamQuestion = z.infer<typeof examQuestionZodSchema>;
