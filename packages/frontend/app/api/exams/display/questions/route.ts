
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { getQuestions } from "@/backend/dist/database/db"; 

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

    const examData = await getQuestions(examId);
  
   console.log(examData)
    return NextResponse.json(
      { success: true, examData: examData },
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