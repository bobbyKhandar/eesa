import { z } from "zod";

/**
 * Analysis Report Schema - Published Exam Analysis Reports
 * 
 * This table stores published exam analysis reports that are made available
 * in the subject-wise question bank. It references the prompt table for questions
 * and is referenced by the subject table.
 */

export const analysisReportZodSchema = z.object({
  // Reference to original exam analysis
  examAnalysisId: z.string().optional(), // Reference to ExamAnalysis collection (optional for Bedrock imports)
  
  // Subject information
  subjectCode: z.string().optional(),
  subjectName: z.string(),
  branch: z.string().optional(),
  institutionName: z.string().optional(), // e.g., "K.J. Somaiya College"
  year: z.string(), // Academic year (e.g., "2024")
  semester: z.string(), // e.g., "S1", "S3", "III"
  examType: z.enum(["main", "kt"]).default("main"),
  maxMarks: z.string().optional(), // Total marks for the exam
  
  // Questions - references to Prompt table
  questionIds: z.array(z.string()).default([]), // Array of Prompt _ids
  
  // Analysis metadata
  totalQuestions: z.number().default(0),
  totalMarks: z.number().optional(),
  
  // Bloom's distribution (percentages)
  bloomDistribution: z.object({
    Recall: z.number().min(0).max(100).default(0),
    Understand: z.number().min(0).max(100).default(0),
    Apply: z.number().min(0).max(100).default(0),
    Analyze: z.number().min(0).max(100).default(0),
    Evaluate: z.number().min(0).max(100).default(0),
    Create: z.number().min(0).max(100).default(0),
  }),
  
  // Overall assessment (without strengths/recommendations/improvements)
  overallAssessment: z.string().optional(),
  
  // Original file info
  originalFileName: z.string(),
  originalFileUrl: z.string().optional(),
  
  // Source tracking
  source: z.enum(['gemini', 'bedrock', 'manual']).default('bedrock'), // How was this analysis generated
  
  // Publishing info
  publishedBy: z.string().optional(), // User ID who published
  publishedAt: z.date().default(() => new Date()),
  
  // Metadata
  tags: z.array(z.string()).default([]),
  viewCount: z.number().default(0),
  isPublic: z.boolean().default(true),
  isVerified: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export const analysisReportWithIdZodSchema = analysisReportZodSchema.extend({
  _id: z.string(),
});

// Mongoose schema options
export const analysisReportSchemaOptions = {
  timestamps: true,
  indexes: [
    { fields: { subjectName: 1, year: -1 } },
    { fields: { subjectCode: 1, year: -1 } },
    { fields: { publishedAt: -1 } },
    { fields: { examAnalysisId: 1 }, unique: true }, // One report per analysis
    { fields: { isPublic: 1 } },
  ],
};

// Export types
export type AnalysisReport = z.infer<typeof analysisReportZodSchema>;
export type AnalysisReportWithId = z.infer<typeof analysisReportWithIdZodSchema>;
