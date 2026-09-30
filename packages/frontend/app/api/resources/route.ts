import { NextRequest, NextResponse } from "next/server";
import { connect } from "@/backend/src/database/connect";
import { getAllSubjectsWithReportsBySemester } from "@/backend/src/services/publishAnalysisService";
import { UniqueQuestionRepository } from "@/backend/src/database/repositories/UniqueQuestionRepository";
import { AnalysisReportRepository } from "@/backend/src/database/repositories/AnalysisReportRepository";
import { PromptRepository } from "@/backend/src/database/repositories/PromptRepository";
import {
  buildPyqStats,
  buildSubjectCatalog,
  questionTitle,
  type PyqStatsInput,
  type SubjectReportRow,
} from "@/frontend/lib/resourceCatalog";

const uniqueQuestionRepo = new UniqueQuestionRepository();
const analysisReportRepo = new AnalysisReportRepository();
const promptRepo = new PromptRepository();

/**
 * GET /api/resources
 * Fetch subjects and their resources (PYQs, unique questions, etc.)
 */
export async function GET(request: NextRequest) {
  try {
    await connect();

    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action"); // "subjects", "pyqs", "questions"
    const subject = searchParams.get("subject")?.trim();
    const branch = searchParams.get("branch");
    const semester = searchParams.get("semester");

    // Get all subjects with reports (for branch/semester selection)
    if (action === "subjects" || !action) {
      // Semester-aware: getAllSubjectsWithReports() drops the semester, which
      // used to make this endpoint file every subject under "Semester 1".
      const rows = (await getAllSubjectsWithReportsBySemester()) as SubjectReportRow[];
      const questionCounts = await uniqueQuestionRepo.getQuestionCountsBySubject();
      const catalog = buildSubjectCatalog(rows, questionCounts);

      return NextResponse.json({
        success: true,
        data: catalog,
      });
    }

    if (action !== "pyqs") {
      return NextResponse.json(
        { success: false, error: `Unsupported action: ${action}` },
        { status: 400 }
      );
    }

    if (!subject) {
      return NextResponse.json(
        { success: false, error: "Missing required query parameter: subject" },
        { status: 400 }
      );
    }

    // Get PYQs (unique questions that appeared in exams) for a specific subject
    const allQuestionsForSubject = await uniqueQuestionRepo.findBySubject(subject, {
      sortBy: "occurrenceCount",
      sortOrder: "desc",
    });

    let pyqs: any[] = [];
    let statsInput: PyqStatsInput = {
      uniqueQuestions: 0,
      totalOccurrences: 0,
      avgOccurrence: 0,
      bloomsDistribution: {},
      subjectCount: 0,
    };

    // If UniqueQuestions collection is empty, fall back to AnalysisReports
    if (allQuestionsForSubject.length === 0) {
      const reports = await analysisReportRepo.findBySubject(subject);
      const ordered = [...reports].sort((a, b) =>
        String(a.year ?? "").localeCompare(String(b.year ?? ""))
      );

      if (ordered.length > 0) {
        // Collect all question IDs from all reports, de-duplicated
        const allQuestionIds = Array.from(new Set(ordered.flatMap(r => r.questionIds || [])));
        const prompts = await promptRepo.findByIds(allQuestionIds);
        const years = ordered.map(r => r.year).filter((v): v is string => Boolean(v));
        const distinctYears = Array.from(new Set(years)).sort();

        // Map prompts to PYQ format
        pyqs = prompts.map((q: any, index: number) => ({
          _id: q._id?.toString() || `q-${index + 1}`,
          id: q._id?.toString() || `q-${index + 1}`,
          title: questionTitle(q.questionText ?? q.text, `Question ${index + 1}`),
          questionText: q.questionText || q.text || "",
          year: distinctYears[0] ?? "2024",
          years: distinctYears,
          examType: ordered[0]?.examType || "main",
          occurrenceCount: 1,
          frequency: 1,
          bloomsLevel: q.bloomsLevel || "understand",
          topic: q.topic || subject,
          topics: q.topic ? [q.topic] : [subject],
          difficulty: getDifficultyFromBlooms(q.bloomsLevel),
          downloadCount: 0,
          sourceReports: ordered.length,
          firstSeenAt: ordered[0]?.publishedAt,
          lastSeenAt: ordered[ordered.length - 1]?.publishedAt,
        }));

        statsInput = {
          uniqueQuestions: prompts.length,
          totalOccurrences: prompts.length,
          avgOccurrence: 1,
          bloomsDistribution: prompts.reduce((acc: Record<string, number>, q: any) => {
            const level = q.bloomsLevel || "understand";
            acc[level] = (acc[level] || 0) + 1;
            return acc;
          }, {}),
          subjectCount: 1,
        };
      }
    } else {
      // Use UniqueQuestions data
      pyqs = allQuestionsForSubject.map((q: any, index: number) => {
        const years = Array.from(
          new Set(
            (q.appearances || [])
              .map((a: any) => a?.year)
              .filter((v: unknown): v is string => Boolean(v))
          )
        ).sort();

        return {
          _id: q._id?.toString() || `q-${index + 1}`,
          id: q._id?.toString() || `q-${index + 1}`,
          title: questionTitle(q.text ?? q.questionText, `Question ${index + 1}`),
          questionText: q.text ?? q.questionText ?? "",
          year: years[0] ?? "",
          years,
          examType: q.appearances?.[0]?.examType || "main",
          occurrenceCount: q.occurrenceCount || 1,
          frequency: q.occurrenceCount || 1,
          bloomsLevel: q.bloomsLevel || "understand",
          topic: q.topic || subject,
          topics: q.topic ? [q.topic] : [subject],
          difficulty: getDifficultyFromBlooms(q.bloomsLevel),
          // No download counter exists for PYQ rows. The UI never displayed a
          // fabricated one, but the route used to invent a random number here,
          // so the same question reported a different value on every request.
          downloadCount: 0,
          sourceReports: q.sourceReports?.length || 1,
          firstSeenAt: q.firstSeenAt,
          lastSeenAt: q.lastSeenAt,
        };
      });

      const statsData = await uniqueQuestionRepo.getSubjectStats(subject);
      statsInput = {
        uniqueQuestions: statsData.totalUniqueQuestions,
        totalOccurrences: statsData.totalOccurrences,
        avgOccurrence: statsData.avgOccurrence,
        bloomsDistribution: statsData.bloomsDistribution,
        subjectCount: 1,
      };
    }

    return NextResponse.json({
      success: true,
      data: {
        pyqs,
        stats: buildPyqStats(statsInput),
      },
    });
  } catch (error: any) {
    console.error("Error fetching resources:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Failed to fetch resources" },
      { status: 500 }
    );
  }
}

function getDifficultyFromBlooms(bloomsLevel: string): string {
  switch (bloomsLevel?.toLowerCase()) {
    case "remember":
    case "understand":
      return "Easy";
    case "apply":
    case "analyze":
      return "Medium";
    case "evaluate":
    case "create":
      return "Hard";
    default:
      return "Medium";
  }
}
