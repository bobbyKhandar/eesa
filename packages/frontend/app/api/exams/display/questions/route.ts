import { NextResponse } from "next/server";
import { ExamRepository } from "@/backend/dist/database/repositories/ExamRepository";
import { toExamineeExam } from "@/backend/src/services/examAccess";
import { getCaller, requireExamContentAccess } from "@/frontend/lib/requestAuth";

const examRepo = new ExamRepository();

export async function POST(req: Request) {
  try {
    const caller = await getCaller();
    if (!caller.userId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { examId } = body;
    if (!examId) {
      return NextResponse.json(
        { success: false, error: "Missing examId" },
        { status: 400 }
      );
    }

    const examData = await examRepo.getWithFullDetails(examId);
    if (!examData) {
      return NextResponse.json(
        { success: false, error: "Exam not found" },
        { status: 404 }
      );
    }

    const access = await requireExamContentAccess(examData);
    if (access.denied) return access.denied;

    return NextResponse.json(
      {
        success: true,
        examData: access.decision.revealAnswerKey ? examData : toExamineeExam(examData),
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("Error fetching questions:", err);
    return NextResponse.json(
      { success: false, error: "Failed to fetch questions" },
      { status: 500 }
    );
  }
}
