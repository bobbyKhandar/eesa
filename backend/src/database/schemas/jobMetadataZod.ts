import { z } from "zod";

/**
 * JobMetadata Schema - Pipeline Job Tracking
 * 
 * Stores complete metadata for each job processed through the AI pipeline.
 * Used for session persistence, job history, and analytics.
 */

export const jobMetadataZodSchema = z.object({
  // Core identifiers
  job_id: z.string(), // UUID from Python server
  filename: z.string(), // Original uploaded filename
  
  // Job status
  status: z.enum(['in_progress', 'success', 'failed', 'partial_success']),
  
  // S3 storage keys
  s3_pdf_key: z.string().optional(), // jobs/{job_id}/original/{filename}
  s3_metadata_key: z.string().optional(), // jobs/{job_id}/metadata.json
  s3_master_index_key: z.string().optional(), // jobs/{job_id}/organized_output/master_index.json
  
  // Timestamps
  started_at: z.date(),
  completed_at: z.date().optional(),
  
  // Error tracking
  error: z.string().optional(),
  error_type: z.enum(['token_limit_exceeded', 'parsing_failed', 'ocr_failed', 'enrichment_failed', 'network_error', 'unknown']).optional(),
  failed_stage: z.enum(['ocr', 'parsing', 'enrichment', 'organization', 'clustering']).optional(),
  
  // Pipeline stages with detailed status
  stages: z.object({
    ocr: z.object({
      status: z.enum(['pending', 'in_progress', 'success', 'failed', 'skipped']),
      started_at: z.date().optional(),
      completed_at: z.date().optional(),
      error: z.string().optional()
    }).optional(),
    
    parsing: z.object({
      status: z.enum(['pending', 'in_progress', 'success', 'failed', 'skipped']),
      started_at: z.date().optional(),
      completed_at: z.date().optional(),
      total_questions: z.number().optional(),
      total_exams: z.number().optional(),
      processing_cost: z.number().optional(),
      is_chunked: z.boolean().optional(),
      error: z.string().optional()
    }).optional(),
    
    enrichment: z.object({
      status: z.enum(['pending', 'in_progress', 'success', 'failed', 'skipped']),
      started_at: z.date().optional(),
      completed_at: z.date().optional(),
      total_questions: z.number().optional(),
      total_enriched: z.number().optional(),
      processing_cost: z.number().optional(),
      retry_count: z.number().optional(),
      error: z.string().optional()
    }).optional(),
    
    organization: z.object({
      status: z.enum(['pending', 'in_progress', 'success', 'failed', 'skipped']),
      started_at: z.date().optional(),
      completed_at: z.date().optional(),
      total_subjects: z.number().optional(),
      total_exams: z.number().optional(),
      total_questions: z.number().optional(),
      subjects: z.record(z.number()).optional(), // { "Math": 20, "Physics": 15 }
      master_index_s3_key: z.string().optional(),
      error: z.string().optional()
    }).optional(),
    
    clustering: z.object({
      status: z.enum(['pending', 'in_progress', 'success', 'failed', 'skipped']),
      started_at: z.date().optional(),
      completed_at: z.date().optional(),
      total_questions: z.number().optional(),
      similar_pairs: z.number().optional(),
      n_clusters: z.number().optional(),
      embedding_model: z.string().optional(),
      error: z.string().optional()
    }).optional()
  }).optional(),
  
  // Aggregated stats
  total_questions: z.number().default(0),
  subjects: z.array(z.string()).default([]), // ["Mathematics", "Physics"]
  
  // S3 retention policy
  s3_expired: z.boolean().default(false), // True if S3 files have been deleted
  retention_days: z.number().default(90), // Days to keep in S3
  
  // User tracking
  uploaded_by: z.string().optional(), // Clerk user ID
  
  // Metadata
  created_at: z.date().default(() => new Date()),
  updated_at: z.date().default(() => new Date())
});

export type JobMetadata = z.infer<typeof jobMetadataZodSchema>;
