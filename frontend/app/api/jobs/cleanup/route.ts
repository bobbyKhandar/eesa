import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { markExpiredJobs, getCleanupStats } from "@/backend/src/services/s3CleanupService";
import { connect } from "@/backend/src/database/connect";

/**
 * GET /api/jobs/cleanup
 * Get cleanup statistics
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

    const stats = await getCleanupStats();

    return NextResponse.json({
      success: true,
      stats
    });
  } catch (error: any) {
    console.error("[Cleanup API] Error fetching stats:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch cleanup stats" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/jobs/cleanup
 * Trigger S3 cleanup - mark expired jobs
 * Body: { retention_days?: number } (default: 90)
 * 
 * Note: Admin only - add role check in production
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

    // TODO: Add admin role check
    // const user = await getUserById(userId)
    // if (user.role !== 'admin') return 403

    await connect();

    const body = await request.json().catch(() => ({}));
    const retentionDays = body.retention_days || 90;

    console.log(`[Cleanup API] Starting cleanup with ${retentionDays} days retention...`);

    const result = await markExpiredJobs(retentionDays);

    return NextResponse.json({
      success: true,
      message: `Cleanup complete: ${result.expired} jobs marked as expired`,
      result
    });
  } catch (error: any) {
    console.error("[Cleanup API] Error running cleanup:", error);
    return NextResponse.json(
      { error: error.message || "Failed to run cleanup" },
      { status: 500 }
    );
  }
}
