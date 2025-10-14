import { z } from "../zodGlobal.js";
/*
 * User Zod Schema definition
 * Transformed to mongoose schema using zod-to-mongoose in mongooseSchemas.ts
 * Represents a user entity with authentication info, role, and exam tracking
 */

export const userZodSchema = z.object({
  _id: z.string().optional(),
  email: z.string().email(),
  name: z.string().optional(),
  role: z.enum(['student', 'teacher', 'admin']).default('student'),
  
  // Currently allocated/active exams
  currentAllocatedExams: z.array(z.string()).default([]), // Array of Exam IDs
  
  // Historical exam submissions
  submissionHistory: z.array(z.string()).default([]), // Array of ExamSubmission IDs
  
  // Authentication metadata
  createdAt: z.date().default(() => new Date()),
  lastLogin: z.date().optional(),
});

export type User = z.infer<typeof userZodSchema>