import { z } from "zod";

/**
 * Response Schema
 * Represents a single question's response within a submission
 */
export const responseZodSchema = z.object({
  // This ID refers to the _id from the ExamQuestion within the Exam's questions array
  questionId: z.string(),
  userResponse: z.string(), // The actual answer text or selected option
  allottedMarks: z.number(),
  feedback: z.string().optional(),
  suggestions: z.array(z.string()).optional(),
});

/**
 * Submission Schema (The User's Completed Exam Attempt)
 * 
 * This document represents a COMPLETED exam submission only.
 * It records the user's answers, marks achieved, and feedback.
 * 
 * CRITICAL: 
 * - This schema is for SUBMITTED exams only (no draft/in-progress state)
 * - All score fields (maxMarks, marksAchieved) are MANDATORY
 * - Status and evaluatedAt fields removed - submissions are always complete
 */
export const submissionZodSchema = z.object({
  // CRITICAL: This links the submission back to the exam template.
  examId: z.string(),

  // Reference to the user who took the exam.
  userId: z.string(),

  // Submission timestamp
  submittedAt: z.date().default(() => new Date()),
  
  // Timing information
  timeSpent: z.number(), // Time in seconds - MANDATORY
  autoSubmitted: z.boolean().default(false),

  // Overall results for the submission - ALL MANDATORY
  maxMarks: z.number(), // Maximum marks possible for the exam
  marksAchieved: z.number(), // Marks obtained by the user
  evaluatorObservations: z.string().optional(),

  // This array holds the detailed answers for this specific submission.
  responses: z.array(responseZodSchema).default([]),
  
  // Email notification tracking
  emailSent: z.boolean().default(false),
  emailSentAt: z.date().optional(),
});

export type Response = z.infer<typeof responseZodSchema>;
export type Submission = z.infer<typeof submissionZodSchema>;

// Legacy schema for backwards compatibility
export const examSubmissionsSchemaZod = z.object({
  examId: z.string(),
  total: z.number().default(0),
  allocated: z.number().default(0),
  score: z.number().default(0),
});