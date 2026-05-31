import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { UploadSessionRepository } from "@/backend/src/database/repositories/UploadSessionRepository";
import { JobMetadataRepository } from "@/backend/src/database/repositories/JobMetadataRepository";
import { connect } from "@/backend/src/database/connect";

const sessionRepo = new UploadSessionRepository();
const jobRepo = new JobMetadataRepository();

/**
 * GET /api/upload-sessions
 * List all upload sessions for the authenticated user
 * Query params: ?active=true (optional - filter active sessions only)
 */
export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth();
    
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized - Please sign in" },
        { status: 401 }
      );
    }

    await connect();

    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get("active") === "true";

    const sessions = await sessionRepo.findByClerkUserId(userId, activeOnly);

    return NextResponse.json({
      success: true,
      sessions,
      count: sessions.length
    });
  } catch (error: any) {
    console.error("[Upload Sessions API] Error fetching sessions:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch sessions" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/upload-sessions
 * Create a new upload session
 * Body: { session_id: string, job_ids: string[], upload_to_subjects: boolean }
 */
export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized - Please sign in" },
        { status: 401 }
      );
    }

    await connect();

    const { session_id, job_ids, upload_to_subjects, notes } = await request.json();

    if (!session_id) {
      return NextResponse.json(
        { error: "session_id is required" },
        { status: 400 }
      );
    }

    const result = await sessionRepo.create({
      session_id,
      clerk_user_id: userId,
      job_ids: job_ids || [],
      upload_to_subjects: upload_to_subjects || false,
      total_jobs: (job_ids || []).length,
      in_progress_jobs: (job_ids || []).length,
      completed_jobs: 0,
      failed_jobs: 0,
      is_active: true,
      notes
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "Failed to create session" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      session_id: result.sessionId,
      message: "Upload session created successfully"
    });
  } catch (error: any) {
    console.error("[Upload Sessions API] Error creating session:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create session" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/upload-sessions?sessionId=xxx
 * Delete a specific session
 */
export async function DELETE(request: NextRequest) {
  try {
    const { userId } = await auth();
    
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized - Please sign in" },
        { status: 401 }
      );
    }

    await connect();

    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("sessionId");

    if (!sessionId) {
      return NextResponse.json(
        { error: "sessionId is required" },
        { status: 400 }
      );
    }

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

    const result = await sessionRepo.delete(sessionId);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "Failed to delete session" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Session deleted successfully"
    });
  } catch (error: any) {
    console.error("[Upload Sessions API] Error deleting session:", error);
    return NextResponse.json(
      { error: error.message || "Failed to delete session" },
      { status: 500 }
    );
  }
}
