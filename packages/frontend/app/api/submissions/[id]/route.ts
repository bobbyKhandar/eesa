import { NextResponse } from "next/server";
import { examRepo, submissionRepo } from "@/backend/dist/database/repositories/index";
import { auth } from "@clerk/nextjs/server";
import { presentSubmissionQuestion } from "@/backend/src/services/mcqAlignment";
import { requireSubmissionAccess } from "@/frontend/lib/requestAuth";
import { resolvePassingPercentage, scorePercentage } from "@/frontend/lib/examResults";

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
    const submission = await submissionRepo.getById(submissionId);
    console.log(submission)
    if (!submission) {
      return NextResponse.json(
        { success: false, error: "Submission not found" },
        { status: 404 }
      );
    }
    console.log("Submission found:", submission);
    const denied = await requireSubmissionAccess(String(submission.userId));
    if (denied) return denied;

    // Get exam with full details (questions + prompts)
    const examWithDetails = await examRepo.getWithFullDetails(submission.examId);
    if (!examWithDetails) {
      return NextResponse.json(
        { success: false, error: "Exam not found" },
        { status: 404 }
      );
    }
    console.log("Exam details found:", examWithDetails.questionDetails);
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
      scorePercentage: scorePercentage(submission.marksAchieved, submission.maxMarks).toFixed(2),
      passingPercentage: resolvePassingPercentage(examWithDetails),
      evaluatorObservations: submission.evaluatorObservations,
      questions: examWithDetails.questionDetails?.map((q: any) => {
        const response = submission.responses?.find((r: any) => r.questionId === q._id?.toString());
        return presentSubmissionQuestion(q, response);
      }) || [],
      responses: (submission.responses || []).map((response: any) => {
        const question = examWithDetails.questionDetails?.find((q: any) => q._id?.toString() === response.questionId);
        if (!question) return response;
        const presented = presentSubmissionQuestion(question, response);
        return {
          ...response,
          userResponse: presented.userResponse?.userResponse ?? response.userResponse,
          maxMarks: presented.maxScore,
        };
      }),
    };
    console.log(result)
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
