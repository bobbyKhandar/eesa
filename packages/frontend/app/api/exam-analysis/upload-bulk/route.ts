import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { connect } from "@/backend/dist/database/connect";
import { ingestBulkExamFile } from "@/frontend/lib/bulkExamIngest";

export async function POST(request: NextRequest) {
  try {
    // Establish database connection
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

    console.log("=== Starting Bulk Exam Analysis Upload ===");

    // Parse form data
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const autoExtractMetadata = formData.get("autoExtractMetadata") === "true";
    const optionalYear = formData.get("optionalYear") as string || undefined;
    const userNotes = formData.get("userNotes") as string || undefined;

    return await ingestBulkExamFile({
      userId,
      file,
      autoExtractMetadata,
      optionalYear,
      userNotes,
    });

  } catch (error) {
    console.error("Error in bulk exam analysis upload:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
