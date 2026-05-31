/*
*TODO: Add Definitions to this file after V1.0 is done
*/

import { z } from "../zodGlobal";

export const subjectZodSchema = z.object({
  subjectName: z.string(),
  subjectDescription: z.string(),
  subjectDegree: z.string(),
  subjectMarks: z.string(),
  subjectUsers: z.array(z.string()),
  subjectOngoingExams: z.array(z.string()).default([]),
  subjectReview: z
    .array(
      z.object({
        studentRating: z.number(),
        studentFeedback: z.string(),
      })
    )
    .default([]),
  numberOfReviews: z.number().default(0),
  totalRating: z.number().default(0),
  subjectPyq: z.array(z.any()).default([]),
  subjectSyllabus: z.string().optional().default(""),
  
  // Question bank - references to AnalysisReport collection
  analysisReportIds: z.array(z.string()).default([]),
});

// User History Schema

export type Subject= z.infer<typeof subjectZodSchema>