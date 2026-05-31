import { z } from "zod";

// Question schema for past papers
export const pastPaperQuestionZodSchema = z.object({
  questionNumber: z.string(), // e.g., "1(a)", "Q2"
  questionText: z.string(),
  marks: z.number(),
  questionType: z.enum(["MCQ", "Short", "Long", "Numerical", "Diagram"]).default("Long"),
  
  // Bloom's taxonomy classification
  bloomLevel: z.enum(["Recall", "Understand", "Apply", "Analyze", "Evaluate", "Create"]).optional(),
  bloomJustification: z.string().optional(),
  
  // Syllabus mapping
  topicsCovered: z.array(z.string()).default([]),
  moduleNumber: z.number().optional(),
  
  // Additional metadata
  difficulty: z.enum(["Easy", "Medium", "Hard"]).optional(),
  keywords: z.array(z.string()).default([]),
});

// Past paper document schema
export const pastPaperDocumentZodSchema = z.object({
  // Academic details
  subjectCode: z.string(),
  subjectName: z.string(),
  branch: z.string(),
  year: z.enum(["FY", "SY", "TY", "LY"]),
  semester: z.string(),
  
  // Exam details
  examType: z.enum(["main", "kt", "resit", "supplementary"]).default("main"),
  examYear: z.number(), // Year when exam was conducted
  examMonth: z.string().optional(), // e.g., "May", "December"
  examDate: z.date().optional(),
  
  // Paper details
  totalMarks: z.number(),
  duration: z.number(), // in minutes
  university: z.string().optional(),
  
  // Questions
  questions: z.array(pastPaperQuestionZodSchema).default([]),
  totalQuestions: z.number(),
  
  // File storage
  originalFile: z.object({
    fileName: z.string(),
    fileUrl: z.string(),
    fileType: z.string(),
    fileSize: z.number(),
  }).optional(),
  
  // OCR/AI processing
  extractedText: z.string().optional(),
  processingStatus: z.enum(["pending", "processing", "completed", "failed"]).default("pending"),
  processingError: z.string().optional(),
  
  // Analysis metadata
  bloomDistribution: z.object({
    Recall: z.number().default(0),
    Understand: z.number().default(0),
    Apply: z.number().default(0),
    Analyze: z.number().default(0),
    Evaluate: z.number().default(0),
    Create: z.number().default(0),
  }).optional(),
  
  topicsCovered: z.array(z.string()).default([]),
  
  // Tracking
  uploadedBy: z.string(), // User ID
  verifiedBy: z.string().optional(), // Admin/faculty verification
  isVerified: z.boolean().default(false),
  isPublic: z.boolean().default(true),
  viewCount: z.number().default(0),
  tags: z.array(z.string()).default([]),
});

// Past paper schema with _id
export const pastPaperZodSchema = pastPaperDocumentZodSchema.extend({
  _id: z.string(),
});

// Mongoose schema options
export const pastPaperSchemaOptions = {
  timestamps: true,
  indexes: [
    { fields: { subjectCode: 1, examYear: 1, examType: 1 } },
    { fields: { branch: 1, year: 1, semester: 1 } },
    { fields: { isPublic: 1, isVerified: 1 } },
    { fields: { uploadedBy: 1 } },
    { fields: { tags: 1 } },
  ],
};

// Export types
export type PastPaperQuestion = z.infer<typeof pastPaperQuestionZodSchema>;
export type PastPaperDocument = z.infer<typeof pastPaperDocumentZodSchema>;
export type PastPaper = z.infer<typeof pastPaperZodSchema>;
