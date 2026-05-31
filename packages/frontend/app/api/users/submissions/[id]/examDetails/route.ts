// app/api/exams/create/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { examRepo,submissionRepo} from "@/backend/dist/database/repositories/index";

export async function GET(req: Request, context: { params: Promise<{ id: string }> }
) {
    try {
      const submissionId = (await context.params).id;
      console.log("Received get full submission and exams details request:", submissionId);

      if (!submissionId) {
        return NextResponse.json(
          { success: false, error: "Missing submission ID" },
          { status: 400 }
      );
    }
    const submissionDetails=await submissionRepo.getById(submissionId);
    if (!submissionDetails) {   
      return NextResponse.json(
        { success: false, error: "Submission not found" },
        { status: 404 }
      );
    }
    const examId = submissionDetails.examId;    
    const results = await examRepo.getById(examId);
    console.log(results);
    if (!results) {
        return NextResponse.json(
            { success: false, error: "Exam not found" },
            { status: 404 }
        );
    }
    const data={
        examId: results.examId,
        submissionId: submissionDetails._id,
            title: results.examTitle,
            description: results.examDescription,
            totalMarks: results.examMaxMarks,
            marksAchieved: submissionDetails.marksAchieved,
            submittedAt: submissionDetails.submittedAt,
        }
    
    return NextResponse.json(
      { success: true, examSet: data },
      { status: 200 }
    );
  } catch (err) {
    console.error("Error creating exam:", err);
    return NextResponse.json(
      { success: false, error: "Failed to create exam" },
      { status: 500 }
    );
  }
}