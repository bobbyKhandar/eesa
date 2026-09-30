import { NextRequest, NextResponse } from "next/server";
import { JobMetadataRepository } from "@/backend/src/database/repositories/JobMetadataRepository";
import { connect } from "@/backend/src/database/connect";
import { fetchFromAiPipeline } from "@/frontend/lib/aiPipeline";
import {
  buildJobStatusPayload,
  isTerminalJobStatus,
  JOB_STATUS_SOURCE,
} from "@/frontend/lib/jobStatus";

const jobRepo = new JobMetadataRepository();

/**
 * GET /api/jobs/[jobId]/status
 * Get job status - queries MongoDB first, falls back to Python server
 * This enables persistent job tracking even after server restarts
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;

    if (!jobId || jobId.trim().length === 0) {
      return NextResponse.json({ error: "Invalid job id" }, { status: 400 });
    }

    await connect();

    // Try MongoDB first for completed jobs
    const jobMetadata = await jobRepo.findById(jobId);

    if (jobMetadata && isTerminalJobStatus(jobMetadata.status)) {
      // Terminal jobs never change again - never hit the pipeline for them.
      console.log(`[Job Status API] Returning from MongoDB for ${jobId} (${jobMetadata.status})`);

      return NextResponse.json(
        buildJobStatusPayload(jobMetadata, JOB_STATUS_SOURCE.mongodb)
      );
    }

    if (jobMetadata) {
      console.log(`[Job Status API] Job ${jobId} is ${jobMetadata.status}, checking pipeline for updates`);
    }

    // Query the pipeline for in-progress jobs or jobs not yet in MongoDB
    console.log(`[Job Status API] Querying pipeline for ${jobId}`);
    const response = await fetchFromAiPipeline(`/job/${encodeURIComponent(jobId)}/status`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // Pipeline unreachable (timeout, connection refused, crash): fall back to
    // the cached MongoDB record instead of failing the whole request. The old
    // code let the fetch throw, so every job showed "Failed to fetch job status"
    // whenever the pipeline was down.
    if (response === null) {
      if (jobMetadata) {
        return NextResponse.json(
          buildJobStatusPayload(jobMetadata, JOB_STATUS_SOURCE.mongodbStale, {
            warning: 'AI pipeline unavailable, showing cached data',
          })
        );
      }

      return NextResponse.json(
        { error: 'AI pipeline unavailable and job is not tracked in the database' },
        { status: 503 }
      );
    }

    if (!response.ok) {
      // Job not found on the pipeline either
      if (jobMetadata) {
        // Return stale MongoDB data with warning
        return NextResponse.json(
          buildJobStatusPayload(jobMetadata, JOB_STATUS_SOURCE.mongodbStale, {
            warning: 'Job not reported by the AI pipeline, showing cached data',
          })
        );
      }

      return NextResponse.json(
        { error: 'Job not found' },
        { status: 404 }
      );
    }

    const serverData = await response.json();

    // If job completed and not in MongoDB yet, we'll catch it on next call
    return NextResponse.json({
      ...serverData,
      source: JOB_STATUS_SOURCE.pipeline
    });

  } catch (error: any) {
    console.error("[Job Status API] Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch job status" },
      { status: 500 }
    );
  }
}
