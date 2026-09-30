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
    // Trim values: a stray space meant to return no reports at all.
    const subjectName = searchParams.get("subjectName")?.trim() || undefined;
    const year = searchParams.get("year")?.trim() || undefined;
    const semester = searchParams.get("semester")?.trim() || undefined;

    // An unknown examType (e.g. "MAIN " or "quiz") silently returned zero
    // reports; ignore anything that is not a real exam type instead.
    const examTypeParam = searchParams.get("examType")?.trim().toLowerCase();
    const examType = examTypeParam === "main" || examTypeParam === "kt" ? examTypeParam : undefined;

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
