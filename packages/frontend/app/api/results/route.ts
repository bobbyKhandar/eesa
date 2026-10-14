import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { submissionRepo, userRepo, examRepo } from "@/backend/dist/database/repositories/index.js";
import {
  buildResultRow,
  shapeAggregatedResultSummary,
  sortResultsByDateDesc,
} from "@/frontend/lib/examResults";
import {
  clampHistoryLimit,
  isInvalidResultsCursorError,
} from "@/backend/src/services/submissionHistoryPage";

/**
 * GET /api/results?limit=20&cursor=
 * One page of the caller's graded history, plus summary metrics for the
 * whole history. Exams referenced by the page are loaded with one `$in`
 * query. Totals come from an aggregation, not from the page of rows.
 */
export async function GET(request: Request) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Get user by Clerk ID (Clerk ID is used as the MongoDB _id)
    const user = await userRepo.getById(userId);

    if (!user) {
      return NextResponse.json(
        { success: false, error: "User not found" },
        { status: 404 }
      );
    }

    const url = new URL(request.url);
    const limit = clampHistoryLimit(url.searchParams.get("limit"));
    const cursorParam = url.searchParams.get("cursor");
    const cursor = cursorParam && cursorParam.trim() !== "" ? cursorParam : null;

    const history = await submissionRepo.getByUser(userId, { limit, cursor });
    const examIds = history.submissions
      .map((submission) => (submission.examId == null ? "" : String(submission.examId)))
      .filter((examId) => examId.length > 0);
    const exams = await examRepo.getHistoricalByIds(examIds);
    const examsById = new Map(exams.map((exam) => [String(exam._id), exam]));

    const results = sortResultsByDateDesc(
      history.submissions.map((submission) =>
        buildResultRow(submission, examsById.get(String(submission.examId)) ?? null)
      )
    );

    const summary = shapeAggregatedResultSummary(
      await submissionRepo.summarizeByUser(userId)
    );

    return NextResponse.json({
      success: true,
      data: {
        results,
        page: {
          limit,
          nextCursor: history.nextCursor,
        },
        stats: summary.stats,
        performanceData: summary.performanceData,
        subjectPerformance: summary.subjectPerformance,
        gradeDistribution: summary.gradeDistribution,
      }
    });
  } catch (error: unknown) {
    if (isInvalidResultsCursorError(error)) {
      return NextResponse.json(
        { success: false, error: "Invalid results cursor" },
        { status: 400 }
      );
    }
    console.error("Error fetching results:", error);
    const message = error instanceof Error ? error.message : "";
    return NextResponse.json(
      { success: false, error: message || "Failed to fetch results" },
      { status: 500 }
    );
  }
}
