import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { ExamSubmissionRepository } from "@/backend/dist/database/repositories/ExamSubmissionRepository";
import { ExamRepository } from "@/backend/dist/database/repositories/ExamRepository";
import { UserRepository } from "@/backend/dist/database/repositories/UserRepository";
import { evaluateExamSubmission } from "@/backend/src/services/examEvaluationService";
import { ExamAttemptRepository } from "@/backend/src/database/repositories/ExamAttemptRepository";
import {
  attemptWindowDecision,
  duplicateSubmissionOutcome,
  scorePercentage,
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
    if (!exam) {
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

    // One submission per user per exam, and the check happens *before* grading.
    // The old order ran the whole Gemini evaluation and only then hit the
    // duplicate guard inside `create`, which reported a 500 "Exam submission
    // already exists" with no submission id - an error the user could not act
    // on and could not retry without paying for the grading twice.
    const existing = await submissionRepo.getByExamAndUser(examId, userId);
    if (existing) {
      const outcome = duplicateSubmissionOutcome(existing);
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

    console.log("Starting AI evaluation for submission...");
    const evaluation = await evaluateExamSubmission(exam.questionDetails || [], responses);
    if ("error" in evaluation) {
      return NextResponse.json(
        { success: false, error: evaluation.error },
        { status: 400 }
      );
    }

    const { responses: evaluatedResponses, marksAchieved: totalMarks, maxMarks: maxTotalMarks } = evaluation;
    const percentage = scorePercentage(totalMarks, maxTotalMarks);

    console.log(`Evaluation complete: ${totalMarks}/${maxTotalMarks} (${percentage.toFixed(2)}%)`);

    // Create submission with AI-evaluated responses
    const submissionResult = await submissionRepo.create({
      examId,
      userId,
      responses: evaluatedResponses,
      submittedAt: new Date(),
      timeSpent: attempt.timeSpent,
      marksAchieved: totalMarks,
      maxMarks: maxTotalMarks,
      autoSubmitted: attempt.autoSubmitted
    });

    if (!submissionResult.success || !submissionResult.submissionId) {
      return NextResponse.json(
        { success: false, error: submissionResult.error || "Failed to create submission" },
        { status: 500 }
      );
    }

    // Add submission to user's history
    await userRepo.addSubmissionToHistory(userId, submissionResult.submissionId);

    return NextResponse.json({
      success: true,
      submissionId: submissionResult.submissionId,
      totalMarks,
      maxTotalMarks,
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
