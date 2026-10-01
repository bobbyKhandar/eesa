// app/api/exams/create/route.ts
import { NextResponse } from "next/server";
import { examRepo } from "@/backend/dist/database/repositories/index";
import { toExamineeExam } from "@/backend/src/services/examAccess";
import { getCaller, requireExamContentAccess } from "@/frontend/lib/requestAuth";


export async function GET(req: Request, context: { params: Promise<{ id: string }> }
) {
    try {
      const caller = await getCaller();
      if (!caller.userId) {
        return NextResponse.json(
          { success: false, error: "Unauthorized" },
          { status: 401 }
        );
      }

      const examId = (await context.params).id;
    console.log("Received exam creation request:", examId);

      if (!examId) {
        return NextResponse.json(
          { success: false, error: "Missing exam ID" },
          { status: 400 }
        );
      }

    const results = await examRepo.getWithFullDetails(examId);
    console.log(examId)
    if (!results) {
      return NextResponse.json(
        { success: false, error: "Exam not found" },
        { status: 404 }
      );
    }

    const access = await requireExamContentAccess(results);
    if (access.denied) return access.denied;

    return NextResponse.json(
      {
        success: true,
        examSet: access.decision.revealAnswerKey ? results : toExamineeExam(results),
      },
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