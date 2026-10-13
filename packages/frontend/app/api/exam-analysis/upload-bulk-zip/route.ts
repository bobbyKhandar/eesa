import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { connect } from "@/backend/dist/database/connect";
import { ingestBulkExamFile } from "@/frontend/lib/bulkExamIngest";
import {
  collectZipResults,
  extractZipPdfs,
  isZipUpload,
  type BulkUploadBody,
} from "@/frontend/lib/bulkZipUpload";

/**
 * POST /api/exam-analysis/upload-bulk-zip
 *
 * The bulk analyze page sends one ZIP as `zipFile`. Each PDF is ingested by
 * the same helper as /upload-bulk, so the signed-in user is stored as
 * analyzedBy and background analysis matches the single-file path.
 */
export async function POST(request: NextRequest) {
  try {
    const dbConnection = await connect();
    if (dbConnection.successCode < 0 || dbConnection.successCode > 1) {
      console.error("Database connection failed:", dbConnection.message);
      return NextResponse.json(
        { success: false, error: "Database connection failed" },
        { status: 503 }
      );
    }

    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const formData = await request.formData();
    const zipFile = formData.get("zipFile");
    if (!(zipFile instanceof File)) {
      return NextResponse.json(
        { success: false, error: "No ZIP file provided" },
        { status: 400 }
      );
    }
    if (!isZipUpload({ name: zipFile.name, type: zipFile.type })) {
      return NextResponse.json(
        { success: false, error: "File must be a ZIP archive" },
        { status: 400 }
      );
    }

    const autoExtractMetadata = formData.get("autoExtractMetadata") === "true";
    const optionalYearRaw = formData.get("optionalYear");
    const userNotesRaw = formData.get("userNotes");
    const optionalYear =
      typeof optionalYearRaw === "string" && optionalYearRaw.length > 0
        ? optionalYearRaw
        : undefined;
    const userNotes =
      typeof userNotesRaw === "string" && userNotesRaw.length > 0
        ? userNotesRaw
        : undefined;

    const extracted = await extractZipPdfs(new Uint8Array(await zipFile.arrayBuffer()));
    if (!extracted.ok) {
      return NextResponse.json(
        { success: false, error: extracted.error },
        { status: 400 }
      );
    }

    const results = await collectZipResults(extracted.files, async (file) => {
      const response = await ingestBulkExamFile({
        userId,
        file,
        autoExtractMetadata,
        optionalYear,
        userNotes,
      });
      return (await response.json()) as BulkUploadBody;
    });

    return NextResponse.json({
      success: true,
      results,
      count: results.length,
      message: `Processed ${extracted.files.length} PDF(s) from ZIP`,
    });
  } catch (error) {
    console.error("Error in bulk ZIP exam analysis upload:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
