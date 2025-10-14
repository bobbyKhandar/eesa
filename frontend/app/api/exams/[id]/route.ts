// app/api/exams/create/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getExamSetData } from "@/backend/dist/database/db";
type RouteContext = {
  params: {
    id: string;
  };
};

export async function POST(req: Request, context: RouteContext) {
    try {
      const examId = context.params.id;
    console.log("Received exam creation request:", examId);

      if (!examId) {
        return NextResponse.json(
          { success: false, error: "Missing exam ID" },
          { status: 400 }
      );
    }

    const results = await getExamSetData(examId);

    return NextResponse.json(
      { success: true, examSet: results },
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