import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { ExamSubmissionRepository } from "@/backend/dist/database/repositories/ExamSubmissionRepository";
import { ExamRepository } from "@/backend/dist/database/repositories/ExamRepository";
import { UserRepository } from "@/backend/dist/database/repositories/UserRepository";
import { evaluateExamResponses } from "@/backend/dist/services/examEvaluationService";

const submissionRepo = new ExamSubmissionRepository();
const examRepo = new ExamRepository();
const userRepo = new UserRepository();

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
    const { examId, responses, timeSpent, autoSubmit } = body;

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
    if (!exam.assignedUsers.includes(userId)) {
      return NextResponse.json(
        { success: false, error: "You are not assigned to this exam" },
        { status: 403 }
      );
    }

    console.log("Starting AI evaluation for submission...");
    
    // Prepare responses with question text for AI evaluation
    const responsesWithQuestions = responses.map((r: any) => {
      const question = exam.questionDetails?.find((q: any) => q._id.toString() === r.questionId.toString());
      return {
        questionId: r.questionId,
        questionText: question?.promptData?.questionText || "Question text not found",
        questionType: question?.questionType || "TEXT",
        userResponse: r.userResponse || "",
        maxMarks: r.maxMarks
      };
    });

    console.log("Sending to Gemini AI for evaluation...");
    // Evaluate responses using Gemini AI
    const evaluatedResponses = await evaluateExamResponses(responsesWithQuestions);
    
    // Calculate total marks
    const totalMarks = evaluatedResponses.reduce((sum: number, r: any) => sum + (r.allottedMarks || 0), 0);
    const maxTotalMarks = evaluatedResponses.reduce((sum: number, r: any) => sum + (r.maxMarks || 0), 0);
    const percentage = maxTotalMarks > 0 ? (totalMarks / maxTotalMarks) * 100 : 0;

    console.log(`Evaluation complete: ${totalMarks}/${maxTotalMarks} (${percentage.toFixed(2)}%)`);

    // Create submission with AI-evaluated responses
    const submissionResult = await submissionRepo.create({
      examId,
      userId,
      responses: evaluatedResponses,
      submittedAt: new Date(),
      timeSpent: timeSpent || 0,
      marksAchieved: totalMarks,
      maxMarks: maxTotalMarks,
      autoSubmitted: autoSubmit || false
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
