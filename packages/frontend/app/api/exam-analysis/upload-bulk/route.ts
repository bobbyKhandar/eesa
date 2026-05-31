import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { connect } from "@/backend/dist/database/connect";
import { ExamAnalysisRepository } from "@/backend/dist/database/repositories/ExamAnalysisRepository";
import { processFileWithOCR, cleanOCRText } from "@/backend/dist/services/ocrService";
import { 
  extractMetadataFromText,
  detectAndSplitMultipleSubjects 
} from "@/backend/dist/services/examAnalysisService";
import { 
  refineAndExtractQuestions, 
  classifyQuestionsWithBlooms,
  calculateBloomDistribution,
  generateAnalysisInsights 
} from "@/backend/dist/services/examAnalysisService";

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

    console.log("=== Starting Bulk Exam Analysis Upload ===");

    // Parse form data
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const autoExtractMetadata = formData.get("autoExtractMetadata") === "true";
    const optionalYear = formData.get("optionalYear") as string || undefined;
    const userNotes = formData.get("userNotes") as string || undefined;

    // Validation
    if (!file) {
      return NextResponse.json(
        { success: false, error: "No file provided" },
        { status: 400 }
      );
    }

    console.log(`Upload details: ${file.name}, ${file.type}, ${file.size} bytes`);

    // Save file to temporary location
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    
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

    let extractedMetadata: any = {
      subjectName: "Unknown Subject",
      year: optionalYear || new Date().getFullYear().toString(),
      semester: "S1",
      examType: "main" as const,
    };

    // Auto-extract metadata if enabled
    if (autoExtractMetadata) {
      console.log("Auto-extracting metadata from exam paper...");
      
      // Run OCR first to get text
      const ocrResult = await processFileWithOCR(filePath, fileType);
      
      if (ocrResult.success && ocrResult.text) {
        const cleanedText = cleanOCRText(ocrResult.text);
        
        // STEP 1: Check if PDF contains multiple subjects
        console.log("Checking for multiple subjects in PDF...");
        const splitResult = await detectAndSplitMultipleSubjects(cleanedText);
        
        if (splitResult.success && splitResult.hasMultipleSubjects && splitResult.subjects) {
          console.log(`Multiple subjects detected: ${splitResult.subjects.length} subjects`);
          
          // Create separate analysis records for each subject
          const analysisResults = [];
          
          for (let i = 0; i < splitResult.subjects.length; i++) {
            const subject = splitResult.subjects[i];
            console.log(`Processing subject ${i + 1}: ${subject.subjectName}`);
            
            // Extract metadata for this specific subject
            const metadataResult = await extractMetadataFromText(subject.textContent, optionalYear);
            
            const subjectMetadata = metadataResult.success && metadataResult.metadata 
              ? metadataResult.metadata 
              : {
                  subjectName: subject.subjectName,
                  subjectCode: subject.subjectCode,
                  year: optionalYear || new Date().getFullYear().toString(),
                  semester: "S1",
                  examType: "main" as const,
                };
            
            // Create analysis document for this subject
            const analysisData: any = {
              subjectName: subjectMetadata.subjectName,
              subjectCode: subjectMetadata.subjectCode || subject.subjectCode,
              branch: subjectMetadata.branch,
              year: subjectMetadata.year,
              semester: subjectMetadata.semester,
              examType: subjectMetadata.examType,
              originalFile: {
                fileName: `${file.name} - ${subject.subjectName}`,
                fileUrl: `/uploads/exam-analysis/${fileName}`,
                fileType,
                fileSize: file.size,
              },
              status: "pending",
              analysisOptions: {
                alignWithSyllabus: false,
                comparePastPapers: false,
                pastPaperIds: [],
              },
              userNotes: `${userNotes || ""}\n[Auto-split from multi-subject PDF${subject.pageRange ? ` - ${subject.pageRange}` : ""}]`,
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
            
            if (createResult.success && createResult.analysisId) {
              console.log(`Created analysis document for ${subject.subjectName}: ${createResult.analysisId}`);
              
              analysisResults.push({
                analysisId: createResult.analysisId,
                subjectName: subjectMetadata.subjectName,
                extractedMetadata: {
                  subjectName: subjectMetadata.subjectName,
                  subjectCode: subjectMetadata.subjectCode || subject.subjectCode,
                  year: subjectMetadata.year,
                  semester: subjectMetadata.semester,
                  pageRange: subject.pageRange,
                },
              });
              
              // Start async processing for this subject
              processExamAnalysis(
                createResult.analysisId,
                filePath,
                fileType,
                subjectMetadata.subjectName,
                subject.textContent // Pass the specific subject text
              ).catch(error => {
                console.error(`Background processing error for ${createResult.analysisId}:`, error);
              });
            }
          }
          
          // Return all created analyses
          return NextResponse.json({
            success: true,
            multipleSubjects: true,
            count: analysisResults.length,
            analyses: analysisResults,
            message: `PDF contains ${analysisResults.length} subjects. Created separate analyses for each.`,
          });
        }
        
        // Single subject - proceed with normal metadata extraction
        const metadataResult = await extractMetadataFromText(cleanedText, optionalYear);
        
        if (metadataResult.success && metadataResult.metadata) {
          extractedMetadata = {
            ...metadataResult.metadata,
            examType: metadataResult.metadata.examType || "main",
          };
          console.log("Extracted metadata:", extractedMetadata);
        }
      }
    }

    // Create initial analysis document with pending status
    const analysisData: any = {
      subjectName: extractedMetadata.subjectName,
      subjectCode: extractedMetadata.subjectCode,
      branch: extractedMetadata.branch,
      year: extractedMetadata.year,
      semester: extractedMetadata.semester,
      examType: extractedMetadata.examType,
      originalFile: {
        fileName: file.name,
        fileUrl: `/uploads/exam-analysis/${fileName}`,
        fileType,
        fileSize: file.size,
      },
      status: "pending",
      analysisOptions: {
        alignWithSyllabus: false,
        comparePastPapers: false,
        pastPaperIds: [],
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
    processExamAnalysis(analysisId, filePath, fileType, extractedMetadata.subjectName).catch(error => {
      console.error(`Background processing error for ${analysisId}:`, error);
    });

    // Return immediately with pending status
    return NextResponse.json({
      success: true,
      analysisId,
      status: "pending",
      multipleSubjects: false,
      extractedMetadata: {
        subjectName: extractedMetadata.subjectName,
        year: extractedMetadata.year,
        semester: extractedMetadata.semester,
      },
      message: "Exam uploaded successfully. Analysis is in progress.",
    });

  } catch (error) {
    console.error("Error in bulk exam analysis upload:", error);
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
  subjectName: string,
  preExtractedText?: string  // Optional: if already extracted (for split subjects)
) {
  try {
    console.log(`\n=== Starting Background Processing for ${analysisId} ===`);
    
    // Ensure database connection for background processing
    await connect();
    
    // Update status to processing
    await analysisRepo.update(analysisId, { status: "processing" });

    // STEP 1: OCR Extraction (skip if we already have text from split detection)
    let cleanedText: string;
    
    if (preExtractedText) {
      console.log("Using pre-extracted text from multi-subject split");
      cleanedText = cleanOCRText(preExtractedText);
    } else {
      console.log("STEP 1: Running OCR extraction...");
      const ocrResult = await processFileWithOCR(filePath, fileType);
      
      if (!ocrResult.success || !ocrResult.text) {
        throw new Error(ocrResult.error || "OCR extraction failed");
      }

      cleanedText = cleanOCRText(ocrResult.text);
      console.log(`OCR completed: ${cleanedText.length} characters extracted`);
    }

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
        isSyllabusAligned: true,
        similarQuestionIds: [],
      })),
      bloomDistribution,
      overallAssessment: insights.overallAssessment,
      recommendations: insights.recommendations,
      strengths: insights.strengths,
      improvements: insights.improvements,
    };

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
