import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { ExamSubmissionRepository } from "@/backend/dist/database/repositories/ExamSubmissionRepository";
import { ExamRepository } from "@/backend/dist/database/repositories/ExamRepository";
import { UserRepository } from "@/backend/dist/database/repositories/UserRepository";
import { evaluateExamSubmission } from "@/backend/src/services/examEvaluationService";
import { submitExamAfterWindow } from "@/backend/src/services/examSubmissionClaim";
import { ExamAttemptRepository } from "@/backend/src/database/repositories/ExamAttemptRepository";
import { isExamDeleted } from "@/backend/src/database/examDeletion";
import {
  attemptWindowDecision,
  scorePercentage,
  submissionConflictOutcome,
} from "@/frontend/lib/examResults";

const submissionRepo = new ExamSubmissionRepository();
const examRepo = new ExamRepository();
const userRepo = new UserRepository();
const attemptRepo = new ExamAttemptRepository();

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    
    if (!userId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { examId, responses } = body;

    // Validate required fields
    if (!examId || !responses || !Array.isArray(responses)) {
      return NextResponse.json(
        { success: false, error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Verify exam exists and get full details with questions
    const exam = await examRepo.getWithFullDetails(examId);
    if (!exam || isExamDeleted(exam.deletedAt)) {
      return NextResponse.json(
        { success: false, error: "Exam not found" },
        { status: 404 }
      );
    }

    // Verify user is assigned to this exam
    if (!exam.assignedUsers?.includes(userId)) {
      return NextResponse.json(
        { success: false, error: "You are not assigned to this exam" },
        { status: 403 }
      );
    }

    // A finished submission (including a legacy row with no grading status) is
    // a 409 before the attempt window is consulted. A pending row is the same
    // status without an id, because that row is only a grading lock.
    const existing = await submissionRepo.getByExamAndUser(examId, userId);
    if (existing) {
      const outcome = submissionConflictOutcome(existing);
      return NextResponse.json(
        { success: false, error: outcome.error, submissionId: outcome.submissionId },
        { status: outcome.status }
      );
    }

    // The attempt row written when the student opened the exam is the clock.
    // A missing row means the client never started, and a row older than the
    // duration plus a short grace is rejected. `timeSpent` from the body is
    // ignored so a forged duration cannot extend the window.
    const opened = await attemptRepo.get(examId, userId);
    const attempt = attemptWindowDecision({
      startedAt: opened?.startedAt,
      durationMinutes: exam.duration,
    });
    if ("error" in attempt) {
      return NextResponse.json(
        { success: false, error: attempt.error },
        { status: attempt.status }
      );
    }

    // Insert the pending submission before Gemini runs. The unique
    // (examId, userId) index is the lock, so a second in-flight request cannot
    // grade. A failed grade deletes that pending row and can be retried.
    const result = await submitExamAfterWindow({
      claim: () =>
        submissionRepo.claimPending({
          examId,
          userId,
          timeSpent: attempt.timeSpent,
          autoSubmitted: attempt.autoSubmitted,
        }),
      grade: async () => {
        console.log("Starting AI evaluation for submission...");
        const evaluation = await evaluateExamSubmission(exam.questionDetails || [], responses);
        if (!("error" in evaluation)) {
          const percentage = scorePercentage(evaluation.marksAchieved, evaluation.maxMarks);
          console.log(
            `Evaluation complete: ${evaluation.marksAchieved}/${evaluation.maxMarks} (${percentage.toFixed(2)}%)`
          );
        }
        return evaluation;
      },
      complete: (submissionId, evaluation) =>
        submissionRepo.completePending(submissionId, {
          examId,
          userId,
          responses: evaluation.responses,
          marksAchieved: evaluation.marksAchieved,
          maxMarks: evaluation.maxMarks,
        }),
      release: (submissionId) => submissionRepo.releasePending(submissionId),
    });

    if (result.status === "duplicate" || result.status === "in_progress") {
      const outcome = submissionConflictOutcome(
        result.status === "duplicate" ? result.submission : { gradingStatus: "pending" }
      );
      return NextResponse.json(
        { success: false, error: outcome.error, submissionId: outcome.submissionId },
        { status: outcome.status }
      );
    }

    if (result.status === "invalid") {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    if (result.status === "failed") {
      return NextResponse.json(
        { success: false, error: result.error || "Failed to create submission" },
        { status: 500 }
      );
    }

    const percentage = scorePercentage(result.totalMarks, result.maxTotalMarks);

    // Add submission to user's history. `completePending` also records it.
    await userRepo.addSubmissionToHistory(userId, result.submissionId);

    return NextResponse.json({
      success: true,
      submissionId: result.submissionId,
      totalMarks: result.totalMarks,
      maxTotalMarks: result.maxTotalMarks,
      percentage: percentage.toFixed(2),
      message: "Exam submitted and evaluated successfully!"
    });

  } catch (error) {
    console.error("Error creating submission:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
