
import { z } from "../zodGlobal.js";
// User Schema
export const userZodSchema = z.object({
  email: z.string(),
  role: z.string().default("user"),
  currentAllocatedExams: z.array(z.string()).default([]),
  history: z.array(z.string()).default([]),
//   userHistory: z.array(userHistoryZodSchema).default([]),
});


export type User= z.infer<typeof User>