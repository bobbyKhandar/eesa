import { AnalysisReportRepository } from "../database/repositories/AnalysisReportRepository";
import { ExamAnalysisRepository } from "../database/repositories/ExamAnalysisRepository";
import { PromptRepository } from "../database/repositories/PromptRepository";
import { UniqueQuestionRepository } from "../database/repositories/UniqueQuestionRepository";
import type { AnalysisReport } from "../database/schemas/index";
import { getSubjectModel } from "../database/mongooseSchemas";
import { connect } from "../database/connect";
import {
  appendCreatedPrompt,
  buildPromptPayload,
  mapBloomLevelToPromptFormat,
  normalizeQuestionText,
  sanitizeBloomDistribution,
  type CreatedPrompt,
  type PromptCreateResult,
} from "./analysisHelpers";

export {
  mapBloomLevelToPromptFormat,
  normalizeQuestionText,
} from "./analysisHelpers";

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

    // Ownership check: a user may only publish analyses they own.
    // Previously the route trusted a client-supplied user id, which allowed
    // anyone signed in to publish someone else's analysis.
    if (analysis.analyzedBy && analysis.analyzedBy !== publishedBy) {
      return {
        success: false,
        error: "Unauthorized - you do not own this analysis",
      };
    }

    const analysisQuestions = Array.isArray(analysis.questions) ? analysis.questions : [];

    if (analysisQuestions.length === 0) {
      return {
        success: false,
        error: "This analysis has no questions to publish",
      };
    }

    // Upload questions to Prompt table.
    // `publishedQuestions` keeps each prompt ID paired with the question it came from,
    // so a failed prompt creation cannot shift the IDs of later questions.
    let publishedQuestions: CreatedPrompt<any>[] = [];

    for (const question of analysisQuestions) {
      const promptData = buildPromptPayload(question, {
        subject: analysis.subjectName,
        source: analysis.originalFile?.fileName,
      });

      if (!promptData) {
        console.warn(`Skipping question with empty text in analysis ${examAnalysisId}`);
        continue;
      }

      const result = await promptRepo.create({
        ...promptData,
        createdBy: publishedBy,
      });

      if (!result.success || !result.promptId) {
        console.error(
          `Failed to create prompt for a question in analysis ${examAnalysisId}: ${result.error}`
        );
        continue;
      }

      publishedQuestions = appendCreatedPrompt(
        publishedQuestions,
        question,
        result as PromptCreateResult
      );
    }

    const questionIds = publishedQuestions.map((entry) => entry.promptId);

    if (publishedQuestions.length === 0) {
      return {
        success: false,
        error: "No questions could be added to the question bank",
      };
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
      totalQuestions: publishedQuestions.length,
      totalMarks: analysis.totalMarks,
      // Guarded: a partial/failed analysis could otherwise fail schema validation.
      bloomDistribution: sanitizeBloomDistribution(analysis.bloomDistribution),
      overallAssessment: analysis.overallAssessment,
      originalFileName: analysis.originalFile?.fileName ?? analysis.subjectName,
      originalFileUrl: analysis.originalFile?.fileUrl,
      publishedBy,
      publishedAt: new Date(),
      tags: analysis.tags || [],
      viewCount: 0,
      isPublic: true,
    };

    const report = await analysisReportRepo.create(reportData);

    // Now add questions to unique questions table, reusing the prompt/question pairing
    for (const { question, promptId } of publishedQuestions) {
      const questionText = String(question.questionText);
      // Normalize question text for deduplication
      const normalizedText = normalizeQuestionText(questionText);

      await uniqueQuestionRepo.findOrCreate({
        questionText,
        normalizedText,
        subject: analysis.subjectName,
        subjectCode: analysis.subjectCode,
        topics: Array.isArray(question.keywords) ? question.keywords : [],
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

// normalizeQuestionText() and mapBloomLevelToPromptFormat() now live in
// ./analysisHelpers and are re-exported above.

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
