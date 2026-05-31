import { z } from "zod";

// Analyzed question schema with Bloom's classification
export const analyzedQuestionZodSchema = z.object({
  questionNumber: z.string(),
  questionText: z.string(),
  marks: z.number(),
  
  // Bloom's taxonomy classification
  bloomLevel: z.enum(["Recall", "Understand", "Apply", "Analyze", "Evaluate", "Create"]),
  bloomJustification: z.string(), // AI-generated explanation
  confidence: z.number().min(0).max(1).optional(), // AI confidence score
  
  // Syllabus alignment
  syllabusTopics: z.array(z.string()).default([]),
  moduleNumber: z.number().optional(),
  isSyllabusAligned: z.boolean().default(true),
  
  // Past paper comparison
  similarQuestionIds: z.array(z.string()).default([]), // IDs of similar questions from past papers
  appearanceFrequency: z.object({
    count: z.number().default(0),
    years: z.array(z.number()).default([]),
  }).optional(),
  
  // Additional metadata
  difficulty: z.enum(["Easy", "Medium", "Hard"]).optional(),
  keywords: z.array(z.string()).default([]),
});

// Syllabus coverage insight
export const syllabusCoverageZodSchema = z.object({
  coveragePercentage: z.number().min(0).max(100).optional(),
  status: z.string().optional(), // e.g., "Strong coverage", "Partial coverage"
  detail: z.string().optional(),
  coveredTopics: z.array(z.string()).default([]),
  missingTopics: z.array(z.string()).default([]),
  tone: z.enum(["success", "warning", "error", "neutral"]).default("neutral"),
});

// Past paper comparison insight
export const pastPaperComparisonZodSchema = z.object({
  status: z.string().optional(), // e.g., "Consistent with prior years"
  detail: z.string().optional(),
  deviation: z.number().optional(), // Percentage deviation
  trends: z.array(z.string()).default([]),
  tone: z.enum(["success", "warning", "error", "neutral"]).default("neutral"),
});

// Bloom's distribution data
export const bloomDistributionZodSchema = z.object({
  Recall: z.number().min(0).max(100).default(0),
  Understand: z.number().min(0).max(100).default(0),
  Apply: z.number().min(0).max(100).default(0),
  Analyze: z.number().min(0).max(100).default(0),
  Evaluate: z.number().min(0).max(100).default(0),
  Create: z.number().min(0).max(100).default(0),
});

// Exam analysis document schema
export const examAnalysisDocumentZodSchema = z.object({
  // Source exam details
  subjectCode: z.string().optional(),
  subjectName: z.string(),
  branch: z.string().optional(),
  year: z.string(), // e.g., "2025"
  semester: z.string(),
  examType: z.enum(["main", "kt"]).default("main"),
  
  // Upload details
  originalFile: z.object({
    fileName: z.string(),
    fileUrl: z.string(),
    fileType: z.string(), // pdf, docx, image
    fileSize: z.number(),
  }),
  
  // Processing status
  status: z.enum(["pending", "processing", "completed", "failed", "published"]).default("pending"),
  processingError: z.string().optional(),
  
  // Analysis options used
  analysisOptions: z.object({
    alignWithSyllabus: z.boolean().default(false),
    syllabusId: z.string().optional(), // Reference to Syllabus collection
    comparePastPapers: z.boolean().default(false),
    pastPaperIds: z.array(z.string()).default([]), // References to PastPaper collection
  }).default({}),
  
  // Extracted content
  extractedText: z.string().optional(),
  totalQuestions: z.number().default(0),
  totalMarks: z.number().optional(),
  
  // Analyzed questions
  questions: z.array(analyzedQuestionZodSchema).default([]),
  
  // Analysis results
  bloomDistribution: bloomDistributionZodSchema,
  
  // Insights (if options enabled)
  syllabusCoverage: syllabusCoverageZodSchema.optional(),
  pastPaperComparison: pastPaperComparisonZodSchema.optional(),
  
  // Additional insights
  overallAssessment: z.string().optional(), // AI-generated summary
  recommendations: z.array(z.string()).default([]),
  strengths: z.array(z.string()).default([]),
  improvements: z.array(z.string()).default([]),
  
  // User notes
  userNotes: z.string().optional(),
  
  // Tracking
  analyzedBy: z.string(), // User ID
  analyzedAt: z.date().default(() => new Date()),
  isPublished: z.boolean().default(false),
  publishedAt: z.date().optional(),
  viewCount: z.number().default(0),
  
  // Sharing
  isPublic: z.boolean().default(false),
  sharedWith: z.array(z.string()).default([]), // User IDs
  tags: z.array(z.string()).default([]),
});

// Exam analysis schema with _id
export const examAnalysisZodSchema = examAnalysisDocumentZodSchema.extend({
  _id: z.string(),
});

// Mongoose schema options
export const examAnalysisSchemaOptions = {
  timestamps: true,
  indexes: [
    { fields: { analyzedBy: 1, analyzedAt: -1 } },
    { fields: { subjectCode: 1, year: 1 } },
    { fields: { status: 1 } },
    { fields: { isPublished: 1, isPublic: 1 } },
    { fields: { tags: 1 } },
  ],
};

// Request/Response schemas for API
export const createExamAnalysisRequestZodSchema = z.object({
  subjectName: z.string(),
  subjectCode: z.string().optional(),
  branch: z.string().optional(),
  year: z.string(),
  semester: z.string(),
  examType: z.enum(["main", "kt"]).default("main"),
  userNotes: z.string().optional(),
  
  analysisOptions: z.object({
    alignWithSyllabus: z.boolean().default(false),
    syllabusId: z.string().optional(),
    comparePastPapers: z.boolean().default(false),
  }),
});

export const updateExamAnalysisRequestZodSchema = z.object({
  status: z.enum(["pending", "processing", "completed", "failed", "published"]).optional(),
  isPublished: z.boolean().optional(),
  isPublic: z.boolean().optional(),
  userNotes: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

// Export types
export type AnalyzedQuestion = z.infer<typeof analyzedQuestionZodSchema>;
export type SyllabusCoverage = z.infer<typeof syllabusCoverageZodSchema>;
export type PastPaperComparison = z.infer<typeof pastPaperComparisonZodSchema>;
export type BloomDistribution = z.infer<typeof bloomDistributionZodSchema>;
export type ExamAnalysisDocument = z.infer<typeof examAnalysisDocumentZodSchema>;
export type ExamAnalysis = z.infer<typeof examAnalysisZodSchema>;
export type CreateExamAnalysisRequest = z.infer<typeof createExamAnalysisRequestZodSchema>;
export type UpdateExamAnalysisRequest = z.infer<typeof updateExamAnalysisRequestZodSchema>;
