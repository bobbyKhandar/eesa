import { NextResponse } from "next/server";
import { ExamRepository } from "@/backend/dist/database/repositories/ExamRepository";

const examRepo = new ExamRepository();

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { examId } = body;
    if (!examId) {
      return NextResponse.json(
        { success: false, error: "Missing examId" },
        { status: 400 }
      );
    }

    const examData = await examRepo.getWithFullDetails(examId);
    return NextResponse.json(
      { success: true, examData },
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
