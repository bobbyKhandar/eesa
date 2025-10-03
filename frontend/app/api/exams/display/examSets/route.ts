// app/api/exams/create/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
// Assuming createExam is now a local function or directly interacts with DB here
import { getExamSetData, getExamSetsId } from "@/backend/dist/database/db"; // Example if it's local

export async function POST(req: Request) {
    try {  
    const body = await req.json();
    const { email } = body;

    if (!email) {
      return NextResponse.json(
        { success: false, error: "Missing email" },
        { status: 400 }
      );
    }

    const examSets = await getExamSetsId(email);
    console.log(examSets)
    const results = await Promise.all(examSets.currentAllocatedExams.map(async (examSetid) => {
      return await getExamSetData(examSetid);
    }));
    return NextResponse.json(
      { success: true, examSets: results },
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