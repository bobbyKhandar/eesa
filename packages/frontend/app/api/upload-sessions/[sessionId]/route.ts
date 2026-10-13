import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { UploadSessionRepository } from "@/backend/src/database/repositories/UploadSessionRepository";
import { JobMetadataRepository } from "@/backend/src/database/repositories/JobMetadataRepository";
import { connect } from "@/backend/src/database/connect";
import {
  foreignStoredJobIds,
  parseJobIdList,
  visibleSessionJob,
} from "@/frontend/lib/uploadSessionJobs";

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

    // Return full documents only for jobs this user uploaded. Other stored
    // jobs use the same placeholder as a missing job so the response does
    // not disclose another user's metadata.
    const storedJobs = await jobRepo.findByJobIds(session.job_ids);
    const jobs = session.job_ids.map((jobId) =>
      visibleSessionJob(jobId, storedJobs, userId)
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

    // Add jobs if provided. A stored job may be attached only by its uploader.
    if (add_job_ids !== undefined && add_job_ids !== null) {
      const parsedJobIds = parseJobIdList(add_job_ids, "add_job_ids");
      if (!parsedJobIds.ok) {
        return NextResponse.json(
          { error: parsedJobIds.error },
          { status: 400 }
        );
      }

      if (parsedJobIds.ids.length > 0) {
        const storedJobs = await jobRepo.findByJobIds(parsedJobIds.ids);
        const foreignJobIds = foreignStoredJobIds(userId, parsedJobIds.ids, storedJobs);
        if (foreignJobIds.length > 0) {
          return NextResponse.json(
            { error: "One or more jobs are not owned by the current user" },
            { status: 403 }
          );
        }

        await sessionRepo.addJobs(sessionId, parsedJobIds.ids);
      }
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
