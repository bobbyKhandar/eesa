import { z } from "zod";

/**
 * UploadSession Schema - User Upload Session Tracking
 * 
 * Tracks batches of uploads by users for session persistence and history.
 * Enables users to resume uploads after page reload.
 */

export const uploadSessionZodSchema = z.object({
  // Core identifiers
  session_id: z.string(), // UUID generated client-side or server-side
  clerk_user_id: z.string(), // Clerk authentication user ID
  
  // Session data
  job_ids: z.array(z.string()).default([]), // Array of job_id (UUID) references
  
  // Session settings
  upload_to_subjects: z.boolean().default(false), // Auto-upload to subjects database
  
  // Session stats
  total_jobs: z.number().default(0),
  completed_jobs: z.number().default(0),
  failed_jobs: z.number().default(0),
  in_progress_jobs: z.number().default(0),
  
  // Session status
  is_active: z.boolean().default(true), // False when user manually closes session
  
  // Timestamps
  created_at: z.date().default(() => new Date()),
  last_accessed_at: z.date().default(() => new Date()),
  completed_at: z.date().optional(), // When all jobs finished
  
  // Metadata
  notes: z.string().optional(), // User notes about this upload batch
});

export type UploadSession = z.infer<typeof uploadSessionZodSchema>;
