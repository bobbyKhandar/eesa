import { NextResponse } from "next/server";
import { examRepo, submissionRepo } from "@/backend/dist/database/repositories/index";
import { auth } from "@clerk/nextjs/server";

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const userId = (await auth()).userId;
    console.log("Authenticated user ID:", userId);
    if (!userId) {
        return NextResponse.json(  
            { success: false, error: "Unauthorized" },
            { status: 401 }
        );
    }

    const submissionId = (await context.params).id;
    console.log("Fetching full submission details:", submissionId);

    if (!submissionId) {
      return NextResponse.json(
        { success: false, error: "Missing submission ID" },
        { status: 400 }
      );
    }

    // Get submission details
    const submission = await submissionRepo.getByExamAndUser(submissionId,userId);
    if (!submission) {
      return NextResponse.json(
        { success: false, error: "Submission not found" },
        { status: 404 }
      );
    }
    console.log("Submission found:", submission);
    // Get exam with full details (questions + prompts)
    const examWithDetails = await examRepo.getWithFullDetails(submission.examId);
    if (!examWithDetails) {
      return NextResponse.json(
        { success: false, error: "Exam not found" },
        { status: 404 }
      );
    }

    // Combine submission and exam data
    const result = {
      id: submission._id?.toString(),
      examId: submission.examId,
      userId: submission.userId,
      examTitle: examWithDetails.examTitle,
      examDescription: examWithDetails.examDescription,
      submittedAt: submission.submittedAt,
      timeSpent: submission.timeSpent,
      autoSubmitted: submission.autoSubmitted || false,
      maxMarks: submission.maxMarks,
      marksAchieved: submission.marksAchieved,
      scorePercentage: ((submission.marksAchieved / submission.maxMarks) * 100).toFixed(2),
      evaluatorObservations: submission.evaluatorObservations,
      questions: examWithDetails.questionDetails?.map((q: any) => ({
        id: q._id?.toString(),
        questionId: q._id?.toString(),
        text: q.promptData?.promptText || q.promptText || '',
        type: q.promptData?.promptType || q.promptType || 'essay',
        options: q.promptData?.options || q.options || [],
        correctAnswer: q.promptData?.correctAnswer || q.correctAnswer,
        maxScore: q.promptData?.maxMarks || q.maxMarks || 10,
        // Match with user's response
        userResponse: submission.responses?.find((r: any) => r.questionId === q._id?.toString()),
      })) || [],
      responses: submission.responses || [],
    };

    return NextResponse.json(
      { success: true, data: result },
      { status: 200 }
    );
  } catch (err) {
    console.error("Error fetching submission details:", err);
    return NextResponse.json(
      { success: false, error: "Failed to fetch submission details" },
      { status: 500 }
    );
  }
}
