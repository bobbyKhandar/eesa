import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { ExamRepository } from "@/backend/dist/database/repositories/ExamRepository";
import { ExamAttemptRepository } from "@/backend/src/database/repositories/ExamAttemptRepository";
import { attemptWindowDecision } from "@/frontend/lib/examResults";

const examRepo = new ExamRepository();
const attemptRepo = new ExamAttemptRepository();

/**
 * POST /api/exams/[id]/attempt
 * Record (or resume) the server-side start of an assigned student's attempt.
 * The countdown and the submit route both take their clock from this row.
 */
export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    const { id: examId } = await context.params;
    if (!examId) {
      return NextResponse.json(
        { success: false, error: "Missing exam ID" },
        { status: 400 },
      );
    }

    const exam = await examRepo.getById(examId);
    if (!exam) {
      return NextResponse.json(
        { success: false, error: "Exam not found" },
        { status: 404 },
      );
    }

    if (!(exam.assignedUsers ?? []).includes(userId)) {
      return NextResponse.json(
        { success: false, error: "You are not assigned to this exam" },
        { status: 403 },
      );
    }

    const attempt = await attemptRepo.open(examId, userId);
    const decision = attemptWindowDecision({
      startedAt: attempt.startedAt,
      durationMinutes: exam.duration,
    });

    if ("error" in decision) {
      return NextResponse.json(
        { success: false, error: decision.error, startedAt: attempt.startedAt },
        { status: decision.status },
      );
    }

    return NextResponse.json({
      success: true,
      startedAt: attempt.startedAt,
      timeSpent: decision.timeSpent,
      remainingSeconds: decision.remainingSeconds,
      autoSubmitted: decision.autoSubmitted,
    });
  } catch (error) {
    console.error("Error opening exam attempt:", error);
    return NextResponse.json(
      { success: false, error: "Failed to start the exam" },
      { status: 500 },
    );
  }
}
