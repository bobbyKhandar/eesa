import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { userRepo } from "@/backend/dist/database/repositories/index";
import { ExamRepository } from "@/backend/dist/database/repositories/ExamRepository";

const examRepo = new ExamRepository();

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    let requestedEmail: string | undefined;
    try {
      requestedEmail = (await req.json())?.email;
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    // The body may only ask for the caller's own exam sets. Reading another
    // account's allocation needs an admin path, which this route does not have.
    if (requestedEmail && requestedEmail !== userId) {
      const caller = await userRepo.getById(userId);
      if (!caller || caller.email !== requestedEmail) {
        return NextResponse.json(
          { success: false, error: "Forbidden" },
          { status: 403 }
        );
      }
    }

    const examIds = await userRepo.getAllocatedExams(userId);

    if (examIds.length === 0) {
      return NextResponse.json(
        { success: true, examSets: [] },
        { status: 200 }
      );
    }

    const examSets = await examRepo.getByIds(examIds);

    return NextResponse.json(
      { success: true, examSets },
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
