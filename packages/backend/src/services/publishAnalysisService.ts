import { AnalysisReportRepository } from "../database/repositories/AnalysisReportRepository";
import { ExamAnalysisRepository } from "../database/repositories/ExamAnalysisRepository";
import { PromptRepository } from "../database/repositories/PromptRepository";
import { UniqueQuestionRepository } from "../database/repositories/UniqueQuestionRepository";
import { getSubjectModel } from "../database/mongooseSchemas";
import { connect } from "../database/connect";
import {
  mapBloomLevelToPromptFormat,
  normalizeQuestionText,
} from "./analysisHelpers";
import {
  publishExamAnalysisWithPorts,
  type PublishAnalysisPorts,
} from "./publishAnalysisMachine";

export type { PublishAnalysisPorts } from "./publishAnalysisMachine";
export {
  isPublicationComplete,
  publishExamAnalysisWithPorts,
} from "./publishAnalysisMachine";

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
 * Publish an exam analysis as an analysis report.
 * This makes it available in the subject-wise question bank.
 *
 * See `publishAnalysisMachine.ts` for why this is a pending/complete state
 * machine instead of a multi-document transaction.
 */
export async function publishExamAnalysis(
  examAnalysisId: string,
  publishedBy: string
): Promise<{
  success: boolean;
  reportId?: string;
  error?: string;
}> {
  const ports: PublishAnalysisPorts = {
    connect,
    findAnalysis: (id) => examAnalysisRepo.findById(id),
    updateAnalysis: (id, patch) => examAnalysisRepo.update(id, patch),
    findReport: (id) => analysisReportRepo.findByExamAnalysisId(id),
    createReport: (data) => analysisReportRepo.create(data),
    updateReport: (id, patch) => analysisReportRepo.update(id, patch),
    createPrompt: (data) => promptRepo.create(data),
    findPrompt: async (id) => {
      const prompt = await promptRepo.findById(id);
      return prompt ? { questionText: prompt.questionText } : null;
    },
    findOrCreateUnique: (data) => uniqueQuestionRepo.findOrCreate(data),
    addReportToSubject,
  };

  return publishExamAnalysisWithPorts(ports, examAnalysisId, publishedBy);
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
 * Same as `getAllSubjectsWithReports()` but one row per subject *per semester*.
 *
 * The resource library drill-down is branch -> semester -> subject, and
 * `getAllSubjectsWithReports()` collapses the semester away, so callers that
 * need it had no way to tell which semesters a subject is actually offered in.
 */
export async function getAllSubjectsWithReportsBySemester() {
  await connect();
  return await analysisReportRepo.getSubjectsBySemesterSummary();
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
