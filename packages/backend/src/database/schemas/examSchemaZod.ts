import { z } from "../zodGlobal";
/*
  * Exam Zod Schema definition 
  * Transformed to mongoose schema using zod-to-mongoose in mongooseSchemas.ts
  * Validates the data before saving it to the database
  * Represents an exam entity including exam metadata, linked questions (via ExamQuestion), and assigned users
  * Note: Student responses are now stored in separate ExamSubmission documents
 */

export const examZodSchema = z.object({
  _id: z.string().optional(),
  examTitle: z.string(),                    // Name of the exam
  examDescription: z.string(),
  passingPercentage: z.number(),            // Minimum percentage required to pass the exam
  examDegree: z.string(),                   // Degree programme for which the exam is conducted
  subject: z.string(),                      // Subject ID reference
  examMaxMarks: z.number(),                 // Total marks for the exam (sum of all question marks)
  examType: z.string(),                     // Exam status/type displayed in the UI
  duration: z.number().optional(),          // Duration in minutes
  scheduledAt: z.date().optional(),         // Scheduled start time
  createdBy: z.string(),                    // User ID of creator
  createdAt: z.date().default(() => new Date()),
  
  // Array of ExamQuestion IDs (references to examQuestionSchemaZod)
  questions: z.array(z.string()),
  
  // Array of assigned user IDs
  assignedUsers: z.array(z.string()).default([]),
  
  // Instructions/rules for the exam
  instructions: z.string().optional(),
  
  // Negative marking configuration
  negativeMarking: z.boolean().default(false),
  negativeMarkingPercentage: z.number().optional(),
})

export type Exam = z.infer<typeof examZodSchema>