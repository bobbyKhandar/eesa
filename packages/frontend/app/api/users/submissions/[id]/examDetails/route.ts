// app/api/users/submissions/[id]/examDetails/route.ts
import { NextResponse } from "next/server";
import { examRepo, submissionRepo } from "@/backend/dist/database/repositories/index";
import { scorePercentage } from "@/frontend/lib/examResults";
import { requireSubmissionAccess } from "@/frontend/lib/requestAuth";

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const submissionId = (await context.params).id;

    if (!submissionId) {
      return NextResponse.json(
        { success: false, error: "Missing submission ID" },
        { status: 400 }
      );
    }

    const submissionDetails = await submissionRepo.getById(submissionId);
    if (!submissionDetails) {
      return NextResponse.json(
        { success: false, error: "Submission not found" },
        { status: 404 }
      );
    }

    const denied = await requireSubmissionAccess(String(submissionDetails.userId));
    if (denied) return denied;

    const exam = await examRepo.getById(submissionDetails.examId);
    if (!exam) {
      return NextResponse.json(
        { success: false, error: "Exam not found" },
        { status: 404 }
      );
    }

    // Marks come from the submission, which records the total the grader
    // actually used. Reading `examMaxMarks` off the exam instead reported a
    // percentage against a total that may since have changed, and produced
    // `null` on the dashboard whenever the exam had no stored `examMaxMarks`.
    const totalMarks = submissionDetails.maxMarks ?? exam.examMaxMarks;

    return NextResponse.json(
      {
        success: true,
        examSet: {
          // Exam documents carry `_id`; there is no `examId` field, so this used
          // to serialise as `undefined` and broke every link built from it.
          examId: String(exam._id),
          submissionId: String(submissionDetails._id),
          title: exam.examTitle,
          description: exam.examDescription,
          subject: exam.subject ?? "General",
          totalMarks,
          marksAchieved: submissionDetails.marksAchieved ?? 0,
          percentage: scorePercentage(submissionDetails.marksAchieved, totalMarks).toFixed(2),
          submittedAt: submissionDetails.submittedAt,
        },
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("Error fetching exam details for submission:", err);
    return NextResponse.json(
      { success: false, error: "Failed to fetch exam details" },
      { status: 500 }
    );
  }
}
