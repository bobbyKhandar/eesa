import { z } from "zod";

// Syllabus topic schema - granular topic breakdown
export const syllabusTopicZodSchema = z.object({
  topicNumber: z.string(), // e.g., "1.1", "2.3.1"
  title: z.string(),
  description: z.string().optional(),
  subtopics: z.array(z.string()).default([]),
  learningObjectives: z.array(z.string()).default([]),
  estimatedHours: z.number().optional(),
  keywords: z.array(z.string()).default([]),
});

// Module/Unit schema
export const syllabusModuleZodSchema = z.object({
  moduleNumber: z.number(),
  title: z.string(),
  description: z.string().optional(),
  topics: z.array(syllabusTopicZodSchema).default([]),
  totalHours: z.number().optional(),
});

// File attachment schema
export const fileAttachmentZodSchema = z.object({
  fileName: z.string(),
  fileUrl: z.string(), // S3/cloud storage URL
  fileType: z.string(), // e.g., "pdf", "docx"
  fileSize: z.number(), // in bytes
  uploadedAt: z.date().default(() => new Date()),
});

// Syllabus document schema
export const syllabusDocumentZodSchema = z.object({
  title: z.string(), // e.g., "Physics (2025 Curriculum)"
  subjectCode: z.string(), // Reference to Subject
  subjectName: z.string(),
  
  // Academic details
  academicYear: z.string(), // e.g., "2025-2026"
  semester: z.string(),
  branch: z.string().optional(),
  university: z.string().optional(),
  
  // Curriculum details
  curriculumVersion: z.string().optional(), // e.g., "2025 Revised", "CBCS 2023"
  effectiveFrom: z.date(),
  effectiveTo: z.date().optional(),
  
  // Structured content
  modules: z.array(syllabusModuleZodSchema).default([]),
  
  // Document files
  originalFile: fileAttachmentZodSchema.optional(), // Original uploaded file
  processedFiles: z.array(fileAttachmentZodSchema).default([]), // Processed/parsed versions
  
  // Metadata
  totalCredits: z.number().optional(),
  totalHours: z.number().optional(),
  prerequisites: z.array(z.string()).default([]),
  
  // AI-extracted data
  extractedText: z.string().optional(), // Full text from PDF/DOCX
  extractedTopics: z.array(z.string()).default([]), // AI-extracted topic list
  processingStatus: z.enum(["pending", "processing", "completed", "failed"]).default("pending"),
  processingError: z.string().optional(),
  
  // Tracking
  createdBy: z.string(), // User ID
  isActive: z.boolean().default(true),
  usage: z.object({
    timesUsed: z.number().default(0),
    lastUsed: z.date().optional(),
  }).default({}),
});

// Syllabus schema with _id for API responses
export const syllabusZodSchema = syllabusDocumentZodSchema.extend({
  _id: z.string(),
});

// Mongoose schema options
export const syllabusSchemaOptions = {
  timestamps: true,
  indexes: [
    { fields: { subjectCode: 1, academicYear: 1 } },
    { fields: { isActive: 1 } },
    { fields: { effectiveFrom: 1, effectiveTo: 1 } },
    { fields: { createdBy: 1 } },
  ],
};

// Export types
export type SyllabusTopic = z.infer<typeof syllabusTopicZodSchema>;
export type SyllabusModule = z.infer<typeof syllabusModuleZodSchema>;
export type FileAttachment = z.infer<typeof fileAttachmentZodSchema>;
export type SyllabusDocument = z.infer<typeof syllabusDocumentZodSchema>;
export type Syllabus = z.infer<typeof syllabusZodSchema>;
