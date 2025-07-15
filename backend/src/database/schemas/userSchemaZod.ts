
import { z } from "../zodGlobal.js";
// User Schema
export const userZodSchema = z.object({
  useremail: z.string(),
  userRole: z.string().default("user"),
  totalAllocatedExams: z.string().default("0"),
  totalCompletedExams: z.string().default("0"),
//   userHistory: z.array(userHistoryZodSchema).default([]),
});


export type User= z.infer<typeof User>