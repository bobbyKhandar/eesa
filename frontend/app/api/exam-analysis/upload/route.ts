import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { connect } from "@/backend/dist/database/connect";
import { ExamAnalysisRepository } from "@/backend/dist/database/repositories/ExamAnalysisRepository";
import { processFileWithOCR, cleanOCRText } from "@/backend/dist/services/ocrService";
import { 
  refineAndExtractQuestions, 
  classifyQuestionsWithBlooms,
  calculateBloomDistribution,
  generateAnalysisInsights 
} from "@/backend/dist/services/examAnalysisService";
import type { CreateExamAnalysisRequest } from "@/backend/dist/database/schemas/examAnalysisZod";

const analysisRepo = new ExamAnalysisRepository();

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

    console.log("=== Starting Exam Analysis Upload ===");

    // Parse form data
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const subjectName = formData.get("subjectName") as string;
    const subjectCode = formData.get("subjectCode") as string || undefined;
    const branch = formData.get("branch") as string || undefined;
    const year = formData.get("year") as string;
    const semester = formData.get("semester") as string;
    const examType = formData.get("examType") as "main" | "kt";
    const userNotes = formData.get("userNotes") as string || undefined;
    
    // Analysis options
    const alignWithSyllabus = formData.get("alignWithSyllabus") === "true";
    const syllabusId = formData.get("syllabusId") as string || undefined;
    const comparePastPapers = formData.get("comparePastPapers") === "true";

    // Validation
    if (!file || !subjectName || !year || !semester) {
      return NextResponse.json(
        { success: false, error: "Missing required fields" },
        { status: 400 }
      );
    }

    console.log(`Upload details: ${file.name}, ${file.type}, ${file.size} bytes`);
    console.log(`Subject: ${subjectName}, Year: ${year}, Semester: ${semester}`);

    // Save file to temporary location
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    
    // Create uploads directory if it doesn't exist
    const uploadsDir = join(process.cwd(), "uploads", "exam-analysis");
    await mkdir(uploadsDir, { recursive: true });
    
    const fileName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    const filePath = join(uploadsDir, fileName);
    await writeFile(filePath, buffer);
    
    console.log(`File saved to: ${filePath}`);

    // Determine file type
    const fileType = file.type.includes("pdf") 
      ? "pdf" 
      : file.type.includes("word") || file.name.endsWith(".docx")
      ? "docx"
      : "image";

    // Create initial analysis document with pending status
    const analysisData: any = {
      subjectName,
      subjectCode,
      branch,
      year,
      semester,
      examType,
      originalFile: {
        fileName: file.name,
        fileUrl: `/uploads/exam-analysis/${fileName}`, // TODO: Upload to cloud storage
        fileType,
        fileSize: file.size,
      },
      status: "pending",
      analysisOptions: {
        alignWithSyllabus,
        syllabusId,
        comparePastPapers,
        pastPaperIds: [], // TODO: Find relevant past papers
      },
      userNotes,
      analyzedBy: userId,
      bloomDistribution: {
        Recall: 0,
        Understand: 0,
        Apply: 0,
        Analyze: 0,
        Evaluate: 0,
        Create: 0,
      },
    };

    const createResult = await analysisRepo.create(analysisData);
    
    if (!createResult.success || !createResult.analysisId) {
      return NextResponse.json(
        { success: false, error: "Failed to create analysis record" },
        { status: 500 }
      );
    }

    const analysisId = createResult.analysisId;
    console.log(`Created analysis document: ${analysisId}`);

    // Start async processing (don't wait for it)
    processExamAnalysis(analysisId, filePath, fileType, subjectName).catch(error => {
      console.error(`Background processing error for ${analysisId}:`, error);
    });

    // Return immediately with pending status
    return NextResponse.json({
      success: true,
      analysisId,
      status: "pending",
      message: "Exam uploaded successfully. Analysis is in progress.",
    });

  } catch (error) {
    console.error("Error in exam analysis upload:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Background processing function
 * Pipeline: OCR → Question Extraction & Refinement → Bloom's Classification → Analysis
 */
async function processExamAnalysis(
  analysisId: string,
  filePath: string,
  fileType: string,
  subjectName: string
) {
  try {
    console.log(`\n=== Starting Background Processing for ${analysisId} ===`);
    
    // Ensure database connection for background processing
    await connect();
    
    // Update status to processing
    await analysisRepo.update(analysisId, { status: "processing" });

    // STEP 1: OCR Extraction
    console.log("STEP 1: Running OCR extraction...");
    const ocrResult = await processFileWithOCR(filePath, fileType);
    
    if (!ocrResult.success || !ocrResult.text) {
      throw new Error(ocrResult.error || "OCR extraction failed");
    }

    const cleanedText = cleanOCRText(ocrResult.text);
    console.log(`OCR completed: ${cleanedText.length} characters extracted`);

    // Save extracted text
    await analysisRepo.update(analysisId, {
      extractedText: cleanedText,
    });

    // STEP 2: Question Extraction and Refinement with Gemini AI
    console.log("STEP 2: Extracting and refining questions with Gemini AI...");
    const extractionResult = await refineAndExtractQuestions(cleanedText, subjectName);
    
    if (!extractionResult.success || !extractionResult.questions) {
      throw new Error(extractionResult.error || "Question extraction failed");
    }

    const extractedQuestions = extractionResult.questions;
    console.log(`Extracted ${extractedQuestions.length} questions`);

    // Calculate total questions and marks
    const totalQuestions = extractedQuestions.length;
    const totalMarks = extractedQuestions.reduce((sum, q) => sum + q.marks, 0);

    await analysisRepo.update(analysisId, {
      totalQuestions,
      totalMarks,
    });

    // STEP 3: Bloom's Taxonomy Classification
    console.log("STEP 3: Classifying questions with Bloom's Taxonomy...");
    const classificationResult = await classifyQuestionsWithBlooms(extractedQuestions, subjectName);
    
    if (!classificationResult.success || !classificationResult.classifiedQuestions) {
      throw new Error(classificationResult.error || "Bloom's classification failed");
    }

    const classifiedQuestions = classificationResult.classifiedQuestions;
    console.log(`Classified ${classifiedQuestions.length} questions`);

    // STEP 4: Calculate Bloom's Distribution
    console.log("STEP 4: Calculating Bloom's distribution...");
    const bloomDistribution = calculateBloomDistribution(classifiedQuestions);
    console.log("Distribution:", bloomDistribution);

    // STEP 5: Generate Insights and Recommendations
    console.log("STEP 5: Generating insights...");
    const insights = await generateAnalysisInsights(
      classifiedQuestions,
      bloomDistribution,
      subjectName
    );

    // STEP 6: Save all results
    console.log("STEP 6: Saving analysis results...");
    const updateData: any = {
      status: "completed",
      questions: classifiedQuestions.map(q => ({
        questionNumber: q.questionNumber,
        questionText: q.questionText,
        marks: q.marks,
        bloomLevel: q.bloomLevel,
        bloomJustification: q.bloomJustification,
        confidence: q.confidence,
        difficulty: q.difficulty,
        keywords: q.keywords,
        syllabusTopics: q.topicsCovered,
        isSyllabusAligned: true, // TODO: Implement actual syllabus matching
        similarQuestionIds: [],
      })),
      bloomDistribution,
      overallAssessment: insights.overallAssessment,
      recommendations: insights.recommendations,
      strengths: insights.strengths,
      improvements: insights.improvements,
    };

    // TODO: If alignWithSyllabus is true, match questions to syllabus topics
    // TODO: If comparePastPapers is true, compare with historical data

    await analysisRepo.update(analysisId, updateData);

    console.log(`=== Analysis Complete for ${analysisId} ===\n`);

  } catch (error: any) {
    console.error(`Error in background processing for ${analysisId}:`, error);
    
    // Update status to failed
    await analysisRepo.update(analysisId, {
      status: "failed",
      processingError: error.message || "Processing failed",
    });
  }
}
