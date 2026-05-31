import { NextRequest, NextResponse } from "next/server";
import { getAllSubjectsWithReports, getPublishedReportsForSubject } from "@/backend/dist/services/publishAnalysisService";

/**
 * GET /api/subjects
 * Get all subjects with published reports
 * Query params: ?subjectName=xxx (optional - to get reports for specific subject)
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const subjectName = searchParams.get("subjectName");
    const year = searchParams.get("year") || undefined;
    const semester = searchParams.get("semester") || undefined;
    const examType = searchParams.get("examType") as "main" | "kt" | undefined;

    // Get reports for specific subject
    if (subjectName) {
      const reports = await getPublishedReportsForSubject(subjectName, {
        year,
        semester,
        examType,
      });

      return NextResponse.json({
        subjectName,
        reportCount: reports.length,
        reports,
      });
    }

    // Get all subjects summary
    const subjects = await getAllSubjectsWithReports();

    return NextResponse.json({
      total: subjects.length,
      subjects,
    });

  } catch (error: any) {
    console.error("Error in subjects API:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch subjects" },
      { status: 500 }
    );
  }
}
