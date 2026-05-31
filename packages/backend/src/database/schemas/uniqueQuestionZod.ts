import { z } from "zod";

export const uniqueQuestionZod = z.object({
  questionText: z.string().min(1, "Question text is required"),
  normalizedText: z.string().min(1, "Normalized text is required"), // For deduplication
  subject: z.string().min(1, "Subject is required"),
  subjectCode: z.string().optional(),
  branch: z.string().optional(),
  
  // Question metadata
  questionType: z.enum(['text', 'mcq', 'Short', 'Long', 'Numerical', 'Diagram']).optional(),
  options: z.array(z.string()).optional(), // For MCQ questions
  marks: z.string().optional(),
  
  // Bloom's Taxonomy Classification (updated to match new format)
  bloomLevel: z.enum(['Recall', 'Understand', 'Apply', 'Analyze', 'Evaluate', 'Create']).optional(),
  bloomJustification: z.string().optional(),
  confidence: z.number().optional(), // 0.0-1.0
  difficulty: z.enum(['Easy', 'Medium', 'Hard']).optional(),
  keywords: z.array(z.string()).default([]),
  topicsCovered: z.array(z.string()).default([]),
  
  // Legacy fields for backward compatibility
  topics: z.array(z.string()).default([]),
  bloomsLevel: z.enum(['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create']).optional(),
  
  // Source tracking - which reports contain this question
  sourceReports: z.array(z.string()).default([]), // Array of analysisReportIds
  
  // Occurrence tracking
  occurrenceCount: z.number().default(1), // How many times this question appeared
  firstSeenAt: z.date().default(() => new Date()),
  lastSeenAt: z.date().default(() => new Date()),
  
  // Years and exams where this question appeared
  appearances: z.array(z.object({
    year: z.string(),
    semester: z.string(),
    examType: z.enum(["main", "kt"]),
    analysisReportId: z.string(),
  })).default([]),
  
  // Original prompt references
  promptIds: z.array(z.string()).default([]), // All prompt IDs for this question
  
  // Metadata
  tags: z.array(z.string()).default([]),
  estimatedMarks: z.number().optional(),
  
  // For future FAISS/HDBSCAN
  embedding: z.array(z.number()).optional(), // Vector embedding for similarity search
  clusterId: z.string().optional(), // HDBSCAN cluster assignment
  
  // Flags
  isVerified: z.boolean().default(false),
  isActive: z.boolean().default(true),
  
  // Timestamps
  createdAt: z.date().default(() => new Date()),
  updatedAt: z.date().default(() => new Date()),
});

export type UniqueQuestion = z.infer<typeof uniqueQuestionZod>;

export const uniqueQuestionInsertZod = uniqueQuestionZod.omit({
  createdAt: true,
  updatedAt: true,
});

export type UniqueQuestionInsert = z.infer<typeof uniqueQuestionInsertZod>;
