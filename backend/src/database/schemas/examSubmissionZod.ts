import { z } from "zod";

// Response schema for individual question in submission
export const submissionResponseZodSchema = z.object({
  questionId: z.string(),
  userResponse: z.string(), // The actual answer text or selected option
  maxMarks: z.number(), // Maximum marks possible for this question
  allottedMarks: z.number(), // Marks awarded for this response
  feedback: z.string().optional(),
  suggestions: z.array(z.string()).optional(),
});

// Legacy question evaluation schema (kept for backward compatibility)
export const questionEvaluationZodSchema = z.object({
  questionId: z.string(),
  questionText: z.string(),
  answer: z.string(),
  marks: z.number(),
  allocatedMarks: z.number(),
  feedback: z.string(),
  suggestions: z.array(z.string())
});

// NEW: Exam submission document schema (COMPLETED SUBMISSIONS ONLY)
// No draft/in-progress state - all submissions are complete with mandatory scores
export const examSubmissionDocumentZodSchema = z.object({
  examId: z.string(),
  userId: z.string(),
  submittedAt: z.date().default(() => new Date()),
  timeSpent: z.number(), // Time in seconds - MANDATORY
  autoSubmitted: z.boolean().default(false),
  
  // Score fields - ALL MANDATORY
  maxMarks: z.number(), // Maximum marks possible for the exam
  marksAchieved: z.number(), // Marks obtained by the user
  evaluatorObservations: z.string().optional(),
  
  // Responses array with detailed answers
  responses: z.array(submissionResponseZodSchema).default([]),
  
  // Email notification tracking
  emailSent: z.boolean().default(false),
  emailSentAt: z.date().optional(),
});

// Exam submission schema (for API responses)
export const examSubmissionZodSchema = examSubmissionDocumentZodSchema.extend({
  _id: z.string(),
}).omit({
  // Remove Map type and use Record for API responses
}).extend({
  answers: z.record(z.string(), z.string())
});

// Client question schema for exam creation
export const clientQuestionZodSchema = z.object({
  text: z.string(),
  marks: z.number().positive(),
  type: z.enum(["mcq", "theory"]).default("theory"),
  options: z.array(z.string()).default([]),
  answer: z.string().optional()
});

// Transformed exam schema for API responses
export const transformedExamZodSchema = z.object({
  id: z.string(),
  _id: z.string(),
  title: z.string(),
  description: z.string(),
  questions: z.number(),
  duration: z.number(),
  status: z.string(),
  createdAt: z.string(),
  submissions: z.number()
});

// Submit exam request schema
export const submitExamRequestZodSchema = z.object({
  examId: z.string(),
  studentEmail: z.string().email(),
  answers: z.record(z.string(), z.string()),
  timeSpent: z.number().min(0),
  autoSubmitted: z.boolean().default(false)
});

// Submit exam response schema
export const submitExamResponseZodSchema = z.object({
  success: z.boolean(),
  submissionId: z.string().optional(),
  error: z.string().optional()
});

// Get user exams response schema
export const getUserExamsResponseZodSchema = z.object({
  exams: z.array(transformedExamZodSchema).optional(),
  error: z.string().optional()
});

// Mongoose schema options for exam submissions
export const examSubmissionSchemaOptions = {
  timestamps: true,
  indexes: [
    { fields: { examId: 1, userId: 1 }, options: { unique: true } },
    { fields: { userId: 1 } },
    { fields: { status: 1 } }
  ]
};

// Export types
export type QuestionEvaluation = z.infer<typeof questionEvaluationZodSchema>;
export type ExamSubmissionDocument = z.infer<typeof examSubmissionDocumentZodSchema>;
export type ExamSubmission = z.infer<typeof examSubmissionZodSchema>;
export type ClientQuestion = z.infer<typeof clientQuestionZodSchema>;
export type TransformedExam = z.infer<typeof transformedExamZodSchema>;
export type SubmitExamRequest = z.infer<typeof submitExamRequestZodSchema>;
export type SubmitExamResponse = z.infer<typeof submitExamResponseZodSchema>;
export type GetUserExamsResponse = z.infer<typeof getUserExamsResponseZodSchema>;