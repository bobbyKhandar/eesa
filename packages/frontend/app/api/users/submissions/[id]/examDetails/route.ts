// app/api/users/submissions/[id]/examDetails/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { examRepo, submissionRepo, userRepo } from "@/backend/dist/database/repositories/index";
import { scorePercentage } from "@/frontend/lib/examResults";

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

    // `auth` was imported but never called, so this route answered anonymous
    // callers with any submission's marks.
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const submissionDetails = await submissionRepo.getById(submissionId);
    if (!submissionDetails) {
      return NextResponse.json(
        { success: false, error: "Submission not found" },
        { status: 404 }
      );
    }

    // The submission owner, or an admin. Nobody else.
    if (submissionDetails.userId !== userId) {
      const caller = await userRepo.getById(userId);
      if (caller?.role !== "admin") {
        return NextResponse.json(
          { success: false, error: "Forbidden" },
          { status: 403 }
        );
      }
    }

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
