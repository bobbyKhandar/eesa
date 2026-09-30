import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { ExamAnalysisRepository } from "@/backend/dist/database/repositories/ExamAnalysisRepository";
import { connect } from "@/backend/dist/database/connect";

const analysisRepo = new ExamAnalysisRepository();

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await auth();
    
    if (!userId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }
        // Establish database connection
        const dbConnection = await connect();
        if (dbConnection.successCode < 0 || dbConnection.successCode > 1) {
          console.error("Database connection failed:", dbConnection.message);
          return NextResponse.json(
            { success: false, error: "Database connection failed" },
            { status: 503 }
          );
        }

    const { id: analysisId } = await context.params;
    console.log(`Fetching analysis: ${analysisId}`);

    const analysis = await analysisRepo.getById(analysisId);

    if (!analysis) {
      return NextResponse.json(
        { success: false, error: "Analysis not found" },
        { status: 404 }
      );
    }

    // Check authorization
    if (analysis.analyzedBy !== userId && !analysis.isPublic) {
      return NextResponse.json(
        { success: false, error: "Unauthorized access" },
        { status: 403 }
      );
    }

    // Only count views for finished analyses. The report page polls this route
    // every few seconds while processing, which would otherwise inflate viewCount.
    if (analysis.status !== "pending" && analysis.status !== "processing") {
      await analysisRepo.incrementViewCount(analysisId);
    }

    return NextResponse.json({
      success: true,
      analysis,
    });

  } catch (error) {
    console.error("Error fetching analysis:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await auth();
    
    if (!userId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Establish database connection before touching the repository
    const dbConnection = await connect();
    if (dbConnection.successCode < 0 || dbConnection.successCode > 1) {
      console.error("Database connection failed:", dbConnection.message);
      return NextResponse.json(
        { success: false, error: "Database connection failed" },
        { status: 503 }
      );
    }

    // Next.js 15 delivers route params as a Promise
    const { id: analysisId } = await context.params;

    // Check ownership
    const analysis = await analysisRepo.getById(analysisId);
    if (!analysis) {
      return NextResponse.json(
        { success: false, error: "Analysis not found" },
        { status: 404 }
      );
    }

    if (analysis.analyzedBy !== userId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 403 }
      );
    }

    const result = await analysisRepo.delete(analysisId);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Analysis deleted successfully",
    });

  } catch (error) {
    console.error("Error deleting analysis:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
