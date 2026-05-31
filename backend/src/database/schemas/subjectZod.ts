import { z } from "zod";

// Subject topic schema for syllabus breakdown
export const subjectTopicZodSchema = z.object({
  week: z.string(), // e.g., "Week 1-2"
  topic: z.string(),
  subtopics: z.array(z.string()).default([]),
  estimatedHours: z.number().optional(),
});

// Learning outcome schema
export const learningOutcomeZodSchema = z.object({
  description: z.string(),
  bloomLevel: z.enum(["Recall", "Understand", "Apply", "Analyze", "Evaluate", "Create"]).optional(),
});

// Assessment structure schema
export const assessmentStructureZodSchema = z.object({
  type: z.string(), // e.g., "Assignments", "Midterm Exam"
  weightage: z.string(), // e.g., "20%"
  description: z.string().optional(),
});

// Textbook schema
export const textbookZodSchema = z.object({
  title: z.string(),
  authors: z.string(),
  edition: z.string().optional(),
  type: z.enum(["Primary", "Reference", "Supplementary"]).default("Reference"),
  isbn: z.string().optional(),
});

// Subject document schema
export const subjectDocumentZodSchema = z.object({
  name: z.string(),
  code: z.string().regex(/^[A-Z]{2}\d{3}$/, "Subject code must be in format: XX###"),
  branch: z.string(), // e.g., "Computer Science", "Electrical Engineering"
  
  // Academic info
  year: z.enum(["FY", "SY", "TY", "LY"]), // First Year, Second Year, etc.
  semester: z.string(), // e.g., "Semester 1", "Semester 3"
  credits: z.number().positive(),
  type: z.enum(["Core", "Elective", "Lab", "Project"]).default("Core"),
  
  // Course details
  description: z.string(),
  duration: z.string().default("16 weeks"),
  instructor: z.string().optional(),
  
  // Student info
  enrolledStudents: z.number().default(0),
  maxCapacity: z.number().optional(),
  
  // Prerequisites
  prerequisites: z.array(z.string()).default([]), // Array of subject codes or names
  
  // Detailed curriculum
  learningOutcomes: z.array(learningOutcomeZodSchema).default([]),
  syllabus: z.array(subjectTopicZodSchema).default([]),
  assessments: z.array(assessmentStructureZodSchema).default([]),
  textbooks: z.array(textbookZodSchema).default([]),
  
  // Additional metadata
  language: z.string().default("English"),
  mode: z.enum(["Online", "Offline", "Hybrid"]).default("Offline"),
  
  // Tracking
  createdBy: z.string(), // User ID of creator
  isActive: z.boolean().default(true),
  tags: z.array(z.string()).default([]),
});

// Subject schema with _id for API responses
export const subjectZodSchema = subjectDocumentZodSchema.extend({
  _id: z.string(),
});

// Mongoose schema options
export const subjectSchemaOptions = {
  timestamps: true,
  indexes: [
    { fields: { code: 1 }, options: { unique: true } },
    { fields: { branch: 1, year: 1, semester: 1 } },
    { fields: { isActive: 1 } },
    { fields: { tags: 1 } },
  ],
};

// Export types
export type SubjectTopic = z.infer<typeof subjectTopicZodSchema>;
export type LearningOutcome = z.infer<typeof learningOutcomeZodSchema>;
export type AssessmentStructure = z.infer<typeof assessmentStructureZodSchema>;
export type Textbook = z.infer<typeof textbookZodSchema>;
export type SubjectDocument = z.infer<typeof subjectDocumentZodSchema>;
export type Subject = z.infer<typeof subjectZodSchema>;
