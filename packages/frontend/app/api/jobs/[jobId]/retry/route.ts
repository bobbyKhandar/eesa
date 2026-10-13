import { NextRequest, NextResponse } from "next/server";
import { connect } from "@/backend/src/database/connect";
import { JobMetadataRepository } from "@/backend/src/database/repositories/JobMetadataRepository";
import { fetchFromAiPipeline } from "@/frontend/lib/aiPipeline";
import {
  isRetryableJobStatus,
  jobRetryPipelinePath,
  mapPipelineRetryResponse,
} from "@/frontend/lib/jobRetry";
import { jobContentAccessDecision } from "@/frontend/lib/uploadSessionJobs";
import { deny, getCaller } from "@/frontend/lib/requestAuth";

const jobRepo = new JobMetadataRepository();

/**
 * POST /api/jobs/[jobId]/retry
 * Re-queue a failed question-paper job. The original PDF stays in S3 and the
 * pipeline loads it again. The caller must own the stored job, or be an admin,
 * before the pipeline is called. The service token is attached by
 * fetchFromAiPipeline.
 *
 * A stored failed or partial_success row is terminal for GET /status. After
 * the pipeline accepts the retry, that row is reopened so the upload page
 * keeps polling the new run.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;

    if (!jobId || jobId.trim().length === 0) {
      return NextResponse.json({ success: false, error: "Invalid job id" }, { status: 400 });
    }

    const caller = await getCaller();
    await connect();
    const storedJobs = await jobRepo.findByJobIds([jobId]);
    const denied = deny(
      jobContentAccessDecision({
        callerId: caller.userId,
        callerRole: caller.role,
        jobs: storedJobs,
      })
    );
    if (denied) return denied;

    const response = await fetchFromAiPipeline(jobRetryPipelinePath(jobId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    if (response === null) {
      return NextResponse.json(
        { success: false, error: "AI pipeline unavailable" },
        { status: 503 }
      );
    }

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    const mapped = mapPipelineRetryResponse(response.status, payload);
    if (!mapped.body.success) {
      return NextResponse.json(mapped.body, { status: mapped.status });
    }

    if (isRetryableJobStatus(storedJobs[0]?.status)) {
      const reopened = await jobRepo.reopenForRetry(jobId);
      if (!reopened.success) {
        console.error(
          `[Job Retry API] Pipeline accepted retry for ${jobId} but stored status was not updated: ${reopened.error}`
        );
        return NextResponse.json(
          { success: false, error: "Retry started, but the saved job status could not be updated" },
          { status: 500 }
        );
      }
    }

    return NextResponse.json(mapped.body, { status: mapped.status });
  } catch (error: any) {
    console.error("[Job Retry API] Error:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Failed to retry job" },
      { status: 500 }
    );
  }
}
