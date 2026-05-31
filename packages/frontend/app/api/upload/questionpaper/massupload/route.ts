import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// AI Pipeline server URL (defaults to localhost:5000)
const AI_PIPELINE_URL =
  process.env.AI_PIPELINE_URL || "http://192.168.1.105:5000";

export async function POST(req: NextRequest) {
  try {
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

    // Forward to AI pipeline server for processing
    const response = await fetch(`${AI_PIPELINE_URL}/upload/question-papers`, {
      method: "POST",
      body: pipelineFormData,
    });

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