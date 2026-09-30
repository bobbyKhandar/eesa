import { NextRequest, NextResponse } from "next/server";
import { fetchFromAiPipeline } from "@/frontend/lib/aiPipeline";

/**
 * GET /api/jobs/[jobId]/questions
 * Proxy to the AI pipeline so the browser never talks to Flask directly
 * (the upload UI used to fetch http://localhost:5000 from the browser, which
 * only works on a developer machine).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;

    if (!jobId || jobId.trim().length === 0) {
      return NextResponse.json({ error: "Invalid job id" }, { status: 400 });
    }

    const response = await fetchFromAiPipeline(`/job/${encodeURIComponent(jobId)}/questions`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });

    if (response === null) {
      return NextResponse.json(
        { error: 'AI pipeline unavailable' },
        { status: 503 }
      );
    }

    if (!response.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch job questions' },
        { status: response.status === 404 ? 404 : 502 }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error("[Job Questions API] Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch job questions" },
      { status: 500 }
    );
  }
}
