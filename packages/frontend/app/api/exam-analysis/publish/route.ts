import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { publishExamAnalysis, publishMultipleAnalyses } from "@/backend/dist/services/publishAnalysisService";

/**
 * POST /api/exam-analysis/publish
 * Publish single or multiple exam analyses
 *
 * The publisher is always the authenticated Clerk user - a client-supplied
 * `publishedBy` is ignored so callers cannot publish on someone else's behalf.
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

    const body = await request.json();
    const { analysisIds } = body;
    const publishedBy = userId;

    if (!analysisIds || !Array.isArray(analysisIds) || analysisIds.length === 0) {
      return NextResponse.json(
        { error: "analysisIds array is required" },
        { status: 400 }
      );
    }

    const invalidId = analysisIds.find(
      (id: unknown) => typeof id !== "string" || id.length === 0
    );
    if (invalidId !== undefined) {
      return NextResponse.json(
        { error: "analysisIds must be an array of analysis ID strings" },
        { status: 400 }
      );
    }

    // Single analysis
    if (analysisIds.length === 1) {
      const result = await publishExamAnalysis(analysisIds[0], publishedBy);

      if (!result.success) {
        return NextResponse.json(
          { error: result.error },
          { status: 400 }
        );
      }

      return NextResponse.json({
        message: "Analysis published successfully",
        reportId: result.reportId,
      });
    }

    // Multiple analyses
    const result = await publishMultipleAnalyses(analysisIds, publishedBy);

    // A partial publish still counts as handled, but a total failure must not
    // be reported as a 200 - clients treat 2xx as "everything worked".
    return NextResponse.json(
      {
        message: `Published ${result.published.length} of ${analysisIds.length} analyses`,
        published: result.published,
        failed: result.failed,
        success: result.success,
      },
      { status: result.published.length > 0 ? 200 : 400 }
    );

  } catch (error: any) {
    console.error("Error in publish API:", error);
    return NextResponse.json(
      { error: error.message || "Failed to publish analyses" },
      { status: 500 }
    );
  }
}
