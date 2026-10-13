import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { fetchFromAiPipeline } from "@/frontend/lib/aiPipeline";
import { requireAdminCaller } from "@/frontend/lib/routeAccess";

// The pipeline stores each PDF in S3 before it responds. That is slower than
// the 10s status-poll timeout, and these uploads have no size limit.
const MASS_UPLOAD_PIPELINE_TIMEOUT_MS = 10 * 60 * 1000;

export async function POST(req: NextRequest) {
  try {
    const denied = await requireAdminCaller();
    if (denied) return denied;

    const formData = await req.formData();
    const files = formData.getAll("files");

    if (!files || files.length === 0) {
      return NextResponse.json(
        { success: false, error: "No files provided" },
        { status: 400 }
      );
    }

    console.log(`Uploading ${files.length} files to AI pipeline (no size limit)...`);
    const fileNames = files.map((file: any) => file.name);
    console.log("Files:", fileNames);

    // Create new FormData for AI pipeline server
    const pipelineFormData = new FormData();
    files.forEach((file) => {
      pipelineFormData.append("files", file as Blob);
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
          error: `Pipeline processing failed: ${response.statusText}` 
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

  } catch (err: any) {
    console.error("Upload error:", err);
    return NextResponse.json(
      { 
        success: false, 
        error: err.message || "Failed to process upload" 
      },
      { status: 502 }
    );
  }
}