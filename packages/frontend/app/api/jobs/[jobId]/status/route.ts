import { NextRequest, NextResponse } from "next/server";
import { JobMetadataRepository } from "@/backend/src/database/repositories/JobMetadataRepository";
import { connect } from "@/backend/src/database/connect";

const jobRepo = new JobMetadataRepository();
const AI_PIPELINE_URL = process.env.AI_PIPELINE_URL || "http://192.168.1.105:5000";

/**
 * GET /api/jobs/[jobId]/status
 * Get job status - queries MongoDB first, falls back to Python server
 * This enables persistent job tracking even after server restarts
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    await connect();

    const { jobId } = await params;

    // Try MongoDB first for completed jobs
    const jobMetadata = await jobRepo.findById(jobId);

    if (jobMetadata) {
      // If job is in MongoDB and completed or failed, return immediately
      if (jobMetadata.status === 'success' || jobMetadata.status === 'failed' || jobMetadata.status === 'partial_success') {
        console.log(`[Job Status API] Returning from MongoDB for ${jobId} (${jobMetadata.status})`);
        
        return NextResponse.json({
          job_id: jobMetadata.job_id,
          filename: jobMetadata.filename,
          status: jobMetadata.status,
          stages: jobMetadata.stages,
          error: jobMetadata.error,
          error_type: jobMetadata.error_type,
          failed_stage: jobMetadata.failed_stage,
          started_at: jobMetadata.started_at,
          completed_at: jobMetadata.completed_at,
          total_questions: jobMetadata.total_questions,
          subjects: jobMetadata.subjects,
          s3_expired: jobMetadata.s3_expired,
          s3_pdf_key: jobMetadata.s3_pdf_key,
          source: 'mongodb' // Indicator that this came from DB
        });
      }
      
      // If in_progress in MongoDB, fall through to query Python server for latest status
      console.log(`[Job Status API] Job ${jobId} is in_progress, checking Python server for updates`);
    }

    // Query Python server for in-progress jobs or jobs not yet in MongoDB
    console.log(`[Job Status API] Querying Python server for ${jobId}`);
    const response = await fetch(`${AI_PIPELINE_URL}/job/${jobId}/status`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      // Job not found on server either
      if (jobMetadata) {
        // Return stale MongoDB data with warning
        return NextResponse.json({
          ...jobMetadata,
          warning: 'Python server unavailable, showing cached data',
          source: 'mongodb-stale'
        });
      }
      
      return NextResponse.json(
        { error: 'Job not found' },
        { status: 404 }
      );
    }

    const serverData = await response.json();
    
    // If job completed and not in MongoDB yet, we'll catch it on next from-job call
    // For now, return server data
    return NextResponse.json({
      ...serverData,
      source: 'python-server'
    });

  } catch (error: any) {
    console.error("[Job Status API] Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch job status" },
      { status: 500 }
    );
  }
}
