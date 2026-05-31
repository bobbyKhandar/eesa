import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const query = typeof body === "string" ? body : body?.inputMessage || "";
    if (!query) {
      return NextResponse.json(
        { success: false, error: "Missing query" },
        { status: 400 }
      );
    }
    const { aiExamHelper } = await import(
      "@/backend/src/services/geminiAi.js"
    );
    const result = await aiExamHelper(query);
    return NextResponse.json({ success: true, result });
  } catch (err) {
    console.error("LLM error:", err);
    return NextResponse.json(
      { success: false, error: "AI helper failed" },
      { status: 500 }
    );
  }
}
