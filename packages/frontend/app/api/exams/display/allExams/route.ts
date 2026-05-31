import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { userRepo } from "@/backend/dist/database/repositories/index";
import { ExamRepository } from "@/backend/dist/database/repositories/ExamRepository";

const examRepo = new ExamRepository();

export async function POST(req: Request) {
  try {
    const { email } = await req.json();
    if (!email) {
      return NextResponse.json(
        { success: false, error: "Missing email" },
        { status: 400 }
      );
    }

    const user = await userRepo.getByEmail(email);
    if (!user) {
      return NextResponse.json(
        { success: false, error: "User not found" },
        { status: 404 }
      );
    }

    const examIds = user.currentAllocatedExams || [];
    const results = await Promise.all(
      examIds.map(async (examId: string) => {
        return await examRepo.getById(examId);
      })
    );

    return NextResponse.json(
      { success: true, examSets: results },
      { status: 200 }
    );
  } catch (err) {
    console.error("Error fetching exams:", err);
    return NextResponse.json(
      { success: false, error: "Failed to fetch exams" },
      { status: 500 }
    );
  }
}
