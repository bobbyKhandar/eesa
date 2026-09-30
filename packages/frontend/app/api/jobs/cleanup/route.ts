import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { markExpiredJobs, getCleanupStats } from "@/backend/src/services/s3CleanupService";
import { connect } from "@/backend/src/database/connect";
import { requireAdmin } from "@/frontend/lib/requestAuth";
import { parseRetentionDays } from "@/frontend/lib/jobCleanup";

/**
 * GET /api/jobs/cleanup
 * Get cleanup statistics
 * Query: ?retention_days=<1-3650> (default 90)
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

    const retention = parseRetentionDays(request.nextUrl.searchParams.get("retention_days"));
    if (!retention.ok) {
      return NextResponse.json({ error: retention.error }, { status: 400 });
    }

    await connect();

    const stats = await getCleanupStats(retention.days);

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
 * Body: { retention_days?: number } (1-3650, default 90)
 *
 * Admin only.
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

    const denied = await requireAdmin();
    if (denied) return denied;

    await connect();

    const body = await request.json().catch(() => ({}));
    const retention = parseRetentionDays((body as Record<string, unknown>)?.retention_days);

    if (!retention.ok) {
      return NextResponse.json({ error: retention.error }, { status: 400 });
    }

    console.log(`[Cleanup API] Starting cleanup with ${retention.days} days retention...`);

    const result = await markExpiredJobs(retention.days);

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
