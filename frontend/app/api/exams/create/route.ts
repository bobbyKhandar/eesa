// app/api/exams/create/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
// Assuming createExam is now a local function or directly interacts with DB here
import { createExam } from "@/backend/dist/database/db"; // Example if it's local

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const {
      examTitle,
      examDescription,
      examType,
      examMaxMarks,
      passingPercentage,
      examDegree,
      examUsers,
      questions
    } = body;

    /* ------------- BASIC validation (quick and cheap) ------------- */
    if (
      typeof examTitle        !== "string" ||
      typeof examDescription  !== "string" ||
      typeof examType         !== "string" ||
      typeof examMaxMarks     !== "number" ||
      typeof passingPercentage!== "number" ||
      typeof examDegree       !== "string" ||
      !Array.isArray(examUsers) || 
      !Array.isArray(questions)  || 
      questions.length === 0
    ) {
      return NextResponse.json(
        { success: false, error: "Missing or invalid fields" },
        { status: 400 }
      );
    }

    /* every question needs text and marks */
    for (const q of questions) {
      if (typeof q.text !== "string" || typeof q.marks !== "number") {
        return NextResponse.json(
          { success: false, error: "Invalid question format" + JSON.stringify(q) },
          { status: 400 }
        );
      }
    }

    /* ----------------- create the exam ----------------- */
    await createExam(
      examTitle,
      examDescription,
      examType,
      examMaxMarks,
      passingPercentage,
      examDegree,
      examUsers,
      questions
    );

    return NextResponse.json(
      { success: true, message: "Exam created successfully!" },
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