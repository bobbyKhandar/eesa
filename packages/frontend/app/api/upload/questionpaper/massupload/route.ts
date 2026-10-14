import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { fetchFromAiPipeline } from "@/frontend/lib/aiPipeline";
import {
  assessQuestionPaperUpload,
  forwardedPipelineError,
  getQuestionPaperUploadLimits,
  parseContentLength,
} from "@/frontend/lib/questionPaperUploadLimits";
import { requireAdminCaller } from "@/frontend/lib/routeAccess";

// The pipeline stores each PDF in S3 before it responds. That is slower than
// the 10s status-poll timeout. Count and byte limits run before this forward.
const MASS_UPLOAD_PIPELINE_TIMEOUT_MS = 10 * 60 * 1000;

export async function POST(req: NextRequest) {
  try {
    const denied = await requireAdminCaller();
    if (denied) return denied;

    const limits = getQuestionPaperUploadLimits();
    const contentLength = parseContentLength(req.headers.get("content-length"));
    const headerDecision = assessQuestionPaperUpload({ contentLength, limits });
    if (!headerDecision.ok) {
      return NextResponse.json(
        { success: false, error: headerDecision.error },
        { status: headerDecision.status },
      );
    }

    const formData = await req.formData();
    const files = formData.getAll("files").filter((entry): entry is File => entry instanceof File);

    if (files.length === 0) {
      return NextResponse.json(
        { success: false, error: "No files provided" },
        { status: 400 },
      );
    }

    const decision = assessQuestionPaperUpload({
      files: files.map((file) => ({ name: file.name, size: file.size })),
      limits,
    });
    if (!decision.ok) {
      return NextResponse.json(
        { success: false, error: decision.error },
        { status: decision.status },
      );
    }

    console.log(
      `Uploading ${files.length} files to AI pipeline (max ${limits.maxFileCount} files, ${limits.maxFileBytes} bytes each, ${limits.maxRequestBytes} bytes total)...`,
    );
    const fileNames = files.map((file) => file.name);
    console.log("Files:", fileNames);

    const pipelineFormData = new FormData();
    files.forEach((file) => {
      pipelineFormData.append("files", file);
    });

    // Forward to AI pipeline server for processing. Admin authorization
    // already ran; fetchFromAiPipeline only proves this server is the caller
    // and resolves AI_PIPELINE_URL (loopback when unset).
    const response = await fetchFromAiPipeline(
      "/upload/question-papers",
      {
        method: "POST",
        body: pipelineFormData,
      },
      MASS_UPLOAD_PIPELINE_TIMEOUT_MS
    );

    if (!response) {
      return NextResponse.json(
        { success: false, error: "AI pipeline unavailable" },
        { status: 502 }
      );
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI Pipeline error:", errorText);
      return NextResponse.json(
        {
          success: false,
          error: forwardedPipelineError(response.status, errorText, response.statusText),
        },
        { status: response.status }
      );
    }

    const result = await response.json();
    console.log("Pipeline response:", result);

    return NextResponse.json({
      success: true,
      files: fileNames,
      jobs: result.jobs || [],
      message: result.message || "Files uploaded and processing started"
    });

  } catch (err: unknown) {
    console.error("Upload error:", err);
    const message = err instanceof Error && err.message ? err.message : "Failed to process upload";
    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 502 }
    );
  }
}
