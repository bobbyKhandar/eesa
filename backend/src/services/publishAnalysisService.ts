import { AnalysisReportRepository } from "../database/repositories/AnalysisReportRepository";
import { ExamAnalysisRepository } from "../database/repositories/ExamAnalysisRepository";
import { PromptRepository } from "../database/repositories/PromptRepository";
import { UniqueQuestionRepository } from "../database/repositories/UniqueQuestionRepository";
import type { AnalysisReport } from "../database/schemas/index";
import { getSubjectModel } from "../database/mongooseSchemas";
import { connect } from "../database/connect";

const analysisReportRepo = new AnalysisReportRepository();
const examAnalysisRepo = new ExamAnalysisRepository();
const promptRepo = new PromptRepository();
const uniqueQuestionRepo = new UniqueQuestionRepository();
const SubjectModel = getSubjectModel();

/**
 * Publish an exam analysis as an analysis report
 * This makes it available in the subject-wise question bank
 */
export async function publishExamAnalysis(
  examAnalysisId: string,
  publishedBy: string
): Promise<{
  success: boolean;
  reportId?: string;
  error?: string;
}> {
  try {
    // Ensure database connection
    await connect();
    
    // Check if already published
    const existingReport = await analysisReportRepo.findByExamAnalysisId(examAnalysisId);
    if (existingReport) {
      return {
        success: false,
        error: "This analysis has already been published",
      };
    }

    // Get the exam analysis
    const analysis = await examAnalysisRepo.findById(examAnalysisId);
    if (!analysis) {
      return {
        success: false,
        error: "Exam analysis not found",
      };
    }

    if (analysis.status !== "completed") {
      return {
        success: false,
        error: "Only completed analyses can be published",
      };
    }

    // Upload questions to Prompt table and collect IDs
    const questionIds: string[] = [];
    const reportIdPlaceholder = "temp_" + Date.now(); // Temporary ID until report is created

    for (const question of analysis.questions) {
      // Create prompt from analyzed question
      const promptData = {
        questionText: question.questionText,
        subject: analysis.subjectName,
        topic: question.keywords.join(", ") || undefined,
        generateVia: "ocr" as const,
        source: analysis.originalFile.fileName,
        ocrConfidence: question.confidence,
        createdBy: publishedBy,
        bloomsLevel: mapBloomLevelToPromptFormat(question.bloomLevel),
      };

      const result = await promptRepo.create(promptData);
      if (result.success && result.promptId) {
        questionIds.push(result.promptId);
      }
    }

    // Create analysis report
    const reportData: AnalysisReport = {
      examAnalysisId,
      subjectCode: analysis.subjectCode,
      subjectName: analysis.subjectName,
      branch: analysis.branch,
      year: analysis.year,
      semester: analysis.semester,
      examType: analysis.examType,
      questionIds,
      totalQuestions: analysis.totalQuestions,
      totalMarks: analysis.totalMarks,
      bloomDistribution: analysis.bloomDistribution,
      overallAssessment: analysis.overallAssessment,
      originalFileName: analysis.originalFile.fileName,
      originalFileUrl: analysis.originalFile.fileUrl,
      publishedBy,
      publishedAt: new Date(),
      tags: analysis.tags || [],
      viewCount: 0,
      isPublic: true,
    };

    const report = await analysisReportRepo.create(reportData);

    // Now add questions to unique questions table
    for (let i = 0; i < analysis.questions.length; i++) {
      const question = analysis.questions[i];
      const promptId = questionIds[i];
      
      if (!promptId) continue;

      // Normalize question text for deduplication
      const normalizedText = normalizeQuestionText(question.questionText);

      await uniqueQuestionRepo.findOrCreate({
        questionText: question.questionText,
        normalizedText,
        subject: analysis.subjectName,
        subjectCode: analysis.subjectCode,
        topics: question.keywords || [],
        bloomsLevel: mapBloomLevelToPromptFormat(question.bloomLevel),
        promptIds: [promptId],
        tags: analysis.tags || [],
        isVerified: false,
        isActive: true,
        sourceReports: [],
        occurrenceCount: 1,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
        appearances: [],
        analysisReportId: report._id,
        year: analysis.year,
        semester: analysis.semester,
        examType: analysis.examType,
        estimatedMarks: question.marks,
      });
    }

    // Update exam analysis status to published
    await examAnalysisRepo.update(examAnalysisId, {
      status: "published",
      isPublished: true,
      publishedAt: new Date(),
    });

    // Add report to subject table
    await addReportToSubject(report._id, analysis.subjectName, analysis.subjectCode);

    console.log(`Successfully published analysis ${examAnalysisId} as report ${report._id}`);

    return {
      success: true,
      reportId: report._id,
    };
  } catch (error: any) {
    console.error("Error publishing exam analysis:", error);
    return {
      success: false,
      error: error.message || "Failed to publish analysis",
    };
  }
}

/**
 * Publish multiple exam analyses at once (bulk publish)
 */
export async function publishMultipleAnalyses(
  analysisIds: string[],
  publishedBy: string
): Promise<{
  success: boolean;
  published: string[]; // Successfully published report IDs
  failed: Array<{ analysisId: string; error: string }>;
}> {
  const published: string[] = [];
  const failed: Array<{ analysisId: string; error: string }> = [];

  for (const analysisId of analysisIds) {
    const result = await publishExamAnalysis(analysisId, publishedBy);
    if (result.success && result.reportId) {
      published.push(result.reportId);
    } else {
      failed.push({
        analysisId,
        error: result.error || "Unknown error",
      });
    }
  }

  return {
    success: published.length > 0,
    published,
    failed,
  };
}

/**
 * Add analysis report to subject table
 */
async function addReportToSubject(
  reportId: string,
  subjectName: string,
  subjectCode?: string
): Promise<void> {
  try {
    // Find subject by name
    let subject = await SubjectModel.findOne({ subjectName });

    if (!subject) {
      // Create new subject if it doesn't exist
      subject = await SubjectModel.create({
        subjectName,
        subjectDescription: `Question bank for ${subjectName}`,
        subjectDegree: subjectCode || "General",
        subjectMarks: "100",
        subjectUsers: [],
        subjectOngoingExams: [],
        subjectReview: [],
        numberOfReviews: 0,
        totalRating: 0,
        subjectPyq: [],
        subjectSyllabus: "",
        analysisReportIds: [reportId],
      });
      console.log(`Created new subject: ${subjectName}`);
    } else {
      // Add report to existing subject
      if (!subject.analysisReportIds) {
        subject.analysisReportIds = [];
      }
      if (!subject.analysisReportIds.includes(reportId)) {
        subject.analysisReportIds.push(reportId);
        await subject.save();
      }
      console.log(`Added report to existing subject: ${subjectName}`);
    }
  } catch (error) {
    console.error("Error adding report to subject:", error);
    // Don't throw - report is still created successfully
  }
}

/**
 * Normalize question text for deduplication
 * Removes extra whitespace, punctuation, and converts to lowercase
 */
function normalizeQuestionText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "") // Remove punctuation
    .replace(/\s+/g, " ") // Normalize whitespace
    .trim();
}

/**
 * Map Bloom level from analysis format to prompt format
 */
function mapBloomLevelToPromptFormat(
  bloomLevel: "Recall" | "Understand" | "Apply" | "Analyze" | "Evaluate" | "Create"
): "remember" | "understand" | "apply" | "analyze" | "evaluate" | "create" {
  const mapping: Record<string, any> = {
    Recall: "remember",
    Understand: "understand",
    Apply: "apply",
    Analyze: "analyze",
    Evaluate: "evaluate",
    Create: "create",
  };

  return mapping[bloomLevel] || "understand";
}

/**
 * Get all published reports for a subject
 */
export async function getPublishedReportsForSubject(
  subjectName: string,
  options?: { year?: string; semester?: string; examType?: "main" | "kt" }
) {
  await connect();
  return await analysisReportRepo.findBySubject(subjectName, options);
}

/**
 * Get all unique subjects with published reports
 */
export async function getAllSubjectsWithReports() {
  await connect();
  return await analysisReportRepo.getSubjectsSummary();
}

/**
 * Get report details with questions
 */
export async function getReportWithQuestions(reportId: string) {
  await connect();
  
  const report = await analysisReportRepo.findById(reportId);
  if (!report) {
    return null;
  }

  // Increment view count
  await analysisReportRepo.incrementViewCount(reportId);

  // Fetch all questions
  const questions = await Promise.all(
    report.questionIds.map(id => promptRepo.findById(id))
  );

  return {
    ...report,
    questions: questions.filter(q => q !== null),
  };
}
