import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { submissionRepo, userRepo, examRepo } from "@/backend/dist/database/repositories/index.js";
import {
  buildResultRow,
  calculateGradeDistribution,
  calculatePerformanceTrend,
  calculateSubjectPerformance,
  sortResultsByDateDesc,
  summarizeResults,
} from "@/frontend/lib/examResults";

/**
 * GET /api/results
 * Fetch all exam results/submissions for the current user
 */
export async function GET() {
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

    // Get all submissions for this user
    const submissions = await submissionRepo.getByUser(userId);

    // Enrich submissions with exam details. `buildResultRow` owns every
    // derivation: the percentage, the grade, the pass verdict (from the exam's
    // own `passingPercentage`), the duration and the subject.
    const results = sortResultsByDateDesc(
      await Promise.all(
        submissions.map(async (submission: any) => {
          const exam: any = submission.examId
            ? await examRepo.getById(submission.examId)
            : null;

          return buildResultRow(submission, exam);
        })
      )
    );

    return NextResponse.json({
      success: true,
      data: {
        results,
        stats: summarizeResults(results),
        performanceData: calculatePerformanceTrend(results),
        subjectPerformance: calculateSubjectPerformance(results),
        gradeDistribution: calculateGradeDistribution(results),
      }
    });
  } catch (error: any) {
    console.error("Error fetching results:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Failed to fetch results" },
      { status: 500 }
    );
  }
}
