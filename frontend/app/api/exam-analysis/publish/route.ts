import { NextRequest, NextResponse } from "next/server";
import { publishExamAnalysis, publishMultipleAnalyses } from "@/backend/dist/services/publishAnalysisService";

/**
 * POST /api/exam-analysis/publish
 * Publish single or multiple exam analyses
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { analysisIds, publishedBy } = body;

    if (!analysisIds || !Array.isArray(analysisIds) || analysisIds.length === 0) {
      return NextResponse.json(
        { error: "analysisIds array is required" },
        { status: 400 }
      );
    }

    if (!publishedBy) {
      return NextResponse.json(
        { error: "publishedBy (user ID) is required" },
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

    return NextResponse.json({
      message: `Published ${result.published.length} of ${analysisIds.length} analyses`,
      published: result.published,
      failed: result.failed,
      success: result.success,
    });

  } catch (error: any) {
    console.error("Error in publish API:", error);
    return NextResponse.json(
      { error: error.message || "Failed to publish analyses" },
      { status: 500 }
    );
  }
}
