import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

export async function POST(req: NextRequest) {
  try {
    // The AI helper proxies a paid Gemini call - require an authenticated user.
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized - Please sign in" },
        { status: 401 }
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const query =
      typeof body === "string" ? body : (body as any)?.inputMessage || "";

    if (typeof query !== "string" || query.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: "Missing query" },
        { status: 400 }
      );
    }

    const { aiExamHelper } = await import("@/backend/src/services/geminiAi.js");
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
