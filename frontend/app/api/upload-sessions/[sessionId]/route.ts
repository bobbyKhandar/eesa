import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { UploadSessionRepository } from "@/backend/src/database/repositories/UploadSessionRepository";
import { JobMetadataRepository } from "@/backend/src/database/repositories/JobMetadataRepository";
import { connect } from "@/backend/src/database/connect";

const sessionRepo = new UploadSessionRepository();
const jobRepo = new JobMetadataRepository();

/**
 * GET /api/upload-sessions/[sessionId]
 * Get details of a specific session with populated job data
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { userId } = await auth();
    
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized - Please sign in" },
        { status: 401 }
      );
    }

    await connect();

    const { sessionId } = await params;

    const session = await sessionRepo.findById(sessionId);

    if (!session) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
    }

    // Verify session belongs to user
    if (session.clerk_user_id !== userId) {
      return NextResponse.json(
        { error: "Unauthorized - Session belongs to another user" },
        { status: 403 }
      );
    }

    // Fetch job details for each job_id
    const jobs = await Promise.all(
      session.job_ids.map(async (jobId) => {
        const job = await jobRepo.findById(jobId);
        return job || {
          job_id: jobId,
          status: 'unknown',
          error: 'Job not found in database'
        };
      })
    );

    return NextResponse.json({
      success: true,
      session: {
        ...session,
        jobs // Populate with full job details
      }
    });
  } catch (error: any) {
    console.error("[Upload Session Details API] Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch session details" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/upload-sessions/[sessionId]
 * Update session (add jobs, update stats, etc.)
 * Body: { add_job_ids?: string[], update_stats?: {...}, deactivate?: boolean }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { userId } = await auth();
    
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized - Please sign in" },
        { status: 401 }
      );
    }

    await connect();

    const { sessionId } = await params;
    const { add_job_ids, update_stats, deactivate } = await request.json();

    // Verify session belongs to user
    const session = await sessionRepo.findById(sessionId);
    if (!session) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
    }

    if (session.clerk_user_id !== userId) {
      return NextResponse.json(
        { error: "Unauthorized - Session belongs to another user" },
        { status: 403 }
      );
    }

    // Add jobs if provided
    if (add_job_ids && Array.isArray(add_job_ids) && add_job_ids.length > 0) {
      await sessionRepo.addJobs(sessionId, add_job_ids);
    }

    // Update stats if provided
    if (update_stats) {
      await sessionRepo.updateJobStats(sessionId, update_stats);
    }

    // Deactivate if requested
    if (deactivate === true) {
      await sessionRepo.deactivate(sessionId);
    }

    return NextResponse.json({
      success: true,
      message: "Session updated successfully"
    });
  } catch (error: any) {
    console.error("[Upload Session Update API] Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to update session" },
      { status: 500 }
    );
  }
}
