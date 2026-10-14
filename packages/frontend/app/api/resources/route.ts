import { NextRequest, NextResponse } from "next/server";
import { connect } from "@/backend/src/database/connect";
import { getAllSubjectsWithReportsBySemester } from "@/backend/src/services/publishAnalysisService";
import { UniqueQuestionRepository } from "@/backend/src/database/repositories/UniqueQuestionRepository";
import { AnalysisReportRepository } from "@/backend/src/database/repositories/AnalysisReportRepository";
import { PromptRepository } from "@/backend/src/database/repositories/PromptRepository";
import {
  FALLBACK_PROMPT_PROJECTION,
  clampPyqLimit,
  decodeQuestionBankCursor,
  isInvalidQuestionBankCursorError,
} from "@/backend/src/services/questionBankPage";
import {
  buildPyqStats,
  buildSubjectCatalog,
  mapFallbackPromptToPyq,
  mapStoredQuestionToPyq,
  type PyqStatsInput,
  type SubjectReportRow,
} from "@/frontend/lib/resourceCatalog";

const uniqueQuestionRepo = new UniqueQuestionRepository();
const analysisReportRepo = new AnalysisReportRepository();
const promptRepo = new PromptRepository();

/**
 * GET /api/resources
 * Fetch subjects and their resources (PYQs, unique questions, etc.)
 *
 * `action=pyqs` returns one page of questions. Totals come from an aggregate,
 * not from the rows on the page. Embeddings are not selected.
 */
export async function GET(request: NextRequest) {
  try {
    await connect();

    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action"); // "subjects", "pyqs", "questions"
    const subject = searchParams.get("subject")?.trim();

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

    // Reject a cursor this API did not emit before any question-bank read.
    const limit = clampPyqLimit(searchParams.get("limit"));
    const cursorParam = searchParams.get("cursor");
    const cursor = cursorParam && cursorParam.trim() !== "" ? cursorParam.trim() : null;
    if (cursor) decodeQuestionBankCursor(cursor);

    // Totals are independent of the page. An empty bank falls back to reports.
    const statsData = await uniqueQuestionRepo.getSubjectStats(subject);
    let pyqs: ReturnType<typeof mapStoredQuestionToPyq>[] = [];
    let nextCursor: string | null = null;
    let statsInput: PyqStatsInput;

    if (statsData.totalUniqueQuestions > 0) {
      const page = await uniqueQuestionRepo.findBySubject(subject, {
        sortBy: "occurrenceCount",
        sortOrder: "desc",
        limit,
        cursor,
      });
      pyqs = page.questions.map((question, index) => mapStoredQuestionToPyq(question, index, subject));
      nextCursor = page.nextCursor;
      statsInput = {
        uniqueQuestions: statsData.totalUniqueQuestions,
        totalOccurrences: statsData.totalOccurrences,
        avgOccurrence: statsData.avgOccurrence,
        bloomsDistribution: statsData.bloomsDistribution,
        subjectCount: 1,
      };
    } else {
      const summary = await analysisReportRepo.summarizeFallbackPyqs(
        subject,
        promptRepo.promptCollectionName(),
      );
      const promptPage = await analysisReportRepo.pagePublicPromptIds(subject, { limit, cursor });
      const prompts =
        promptPage.ids.length > 0
          ? await promptRepo.findByIds(promptPage.ids, FALLBACK_PROMPT_PROJECTION)
          : [];
      const promptsById = new Map(
        prompts.map((prompt) => [String((prompt as { _id?: unknown })._id ?? ""), prompt]),
      );
      const ordered = promptPage.ids
        .map((id) => promptsById.get(id))
        .filter((prompt): prompt is (typeof prompts)[number] => prompt != null);

      pyqs = ordered.map((prompt, index) => mapFallbackPromptToPyq(prompt, index, subject, summary));
      nextCursor = promptPage.nextCursor;
      statsInput = {
        uniqueQuestions: summary.uniqueQuestions,
        totalOccurrences: summary.totalOccurrences,
        avgOccurrence: summary.avgOccurrence,
        bloomsDistribution: summary.bloomsDistribution,
        subjectCount: summary.subjectCount,
      };
    }

    return NextResponse.json({
      success: true,
      data: {
        pyqs,
        page: {
          limit,
          nextCursor,
        },
        stats: buildPyqStats(statsInput),
      },
    });
  } catch (error: any) {
    if (isInvalidQuestionBankCursorError(error)) {
      return NextResponse.json(
        { success: false, error: "Invalid question bank cursor" },
        { status: 400 }
      );
    }
    console.error("Error fetching resources:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Failed to fetch resources" },
      { status: 500 }
    );
  }
}
