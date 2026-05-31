import { NextRequest, NextResponse } from "next/server";
import { getReportWithQuestions } from "@/backend/dist/services/publishAnalysisService";

/**
 * GET /api/reports/[reportId]
 * Get published report details with questions
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ reportId: string }> }
) {
  try {
    const params = await context.params;
    const { reportId } = params;

    const report = await getReportWithQuestions(reportId);

    if (!report) {
      return NextResponse.json(
        { error: "Report not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(report);

  } catch (error: any) {
    console.error("Error fetching report:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch report" },
      { status: 500 }
    );
  }
}
