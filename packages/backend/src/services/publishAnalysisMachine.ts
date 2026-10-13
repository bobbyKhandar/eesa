import type { PromptRepository } from "../database/repositories/PromptRepository";
import type { UniqueQuestionRepository } from "../database/repositories/UniqueQuestionRepository";
import type { AnalysisReport } from "../database/schemas/index";
import {
  appendCreatedPrompt,
  buildPromptPayload,
  mapBloomLevelToPromptFormat,
  normalizeQuestionText,
  pairPublishedQuestions,
  sanitizeBloomDistribution,
  type CreatedPrompt,
  type PromptCreateResult,
} from "./analysisHelpers";

type PublishableQuestion = {
  questionText?: string | null;
  keywords?: unknown;
  bloomLevel?: string | null;
  marks?: number;
};

type PublishableAnalysis = {
  status?: string;
  isPublished?: boolean;
  analyzedBy?: string;
  questions?: PublishableQuestion[];
  subjectName: string;
  subjectCode?: string;
  branch?: string;
  year: string;
  semester: string;
  examType: "main" | "kt";
  totalMarks?: number;
  bloomDistribution?: AnalysisReport["bloomDistribution"];
  overallAssessment?: string;
  originalFile?: { fileName?: string; fileUrl?: string };
  tags?: string[];
};

type StoredReport = {
  _id: string;
  publishStatus?: "pending" | "complete" | null;
  questionIds?: string[];
};

export interface PublishAnalysisPorts {
  connect(): Promise<unknown>;
  findAnalysis(examAnalysisId: string): Promise<PublishableAnalysis | null>;
  updateAnalysis(
    examAnalysisId: string,
    patch: { status: "published"; isPublished: true; publishedAt: Date }
  ): Promise<{ success?: boolean; error?: string } | void>;
  findReport(examAnalysisId: string): Promise<StoredReport | null>;
  createReport(data: AnalysisReport): Promise<StoredReport>;
  updateReport(id: string, patch: Partial<AnalysisReport>): Promise<unknown>;
  createPrompt: PromptRepository["create"];
  findPrompt(promptId: string): Promise<{ questionText?: string | null } | null>;
  findOrCreateUnique: UniqueQuestionRepository["findOrCreate"];
  addReportToSubject(
    reportId: string,
    subjectName: string,
    subjectCode?: string
  ): Promise<void>;
}

/**
 * A report is published only when publication finished.
 *
 * `publishStatus: "complete"` is explicit. A missing status is a legacy row:
 * the old publisher marked the exam analysis published only after every
 * unique-question write succeeded, so that flag is what distinguishes a
 * finished legacy report from one left behind by a crash.
 */
export function isPublicationComplete(
  report: { publishStatus?: string | null } | null | undefined,
  analysis?: { status?: string; isPublished?: boolean } | null
): boolean {
  if (!report) return false;
  if (report.publishStatus === "pending") return false;
  if (report.publishStatus === "complete") return true;
  return analysis?.status === "published" || analysis?.isPublished === true;
}

/**
 * Publish an exam analysis as an analysis report.
 *
 * Publication is a recoverable state machine (`publishStatus` pending, then
 * complete) rather than a Mongo multi-document transaction. Transactions run
 * only on a replica set, and this app also supports standalone local Mongo,
 * where they throw. A pending report plus an idempotent unique-question upsert
 * resumes a partial publish on either deployment, including a report already
 * left behind by a failed attempt.
 */
export async function publishExamAnalysisWithPorts(
  ports: PublishAnalysisPorts,
  examAnalysisId: string,
  publishedBy: string
): Promise<{
  success: boolean;
  reportId?: string;
  error?: string;
}> {
  try {
    await ports.connect();

    const analysis = await ports.findAnalysis(examAnalysisId);
    if (!analysis) {
      return {
        success: false,
        error: "Exam analysis not found",
      };
    }

    const existingReport = await ports.findReport(examAnalysisId);
    if (isPublicationComplete(existingReport, analysis)) {
      return {
        success: false,
        error: "This analysis has already been published",
      };
    }

    const resuming = Boolean(existingReport);

    // A retry may already have flipped the analysis to published if the
    // process died after that write and before the report was marked complete.
    if (!resuming && analysis.status !== "completed") {
      return {
        success: false,
        error: "Only completed analyses can be published",
      };
    }

    if (
      resuming &&
      analysis.status !== "completed" &&
      analysis.status !== "published" &&
      analysis.isPublished !== true
    ) {
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

    const publishedQuestions = await collectPublishedQuestions(
      ports,
      examAnalysisId,
      publishedBy,
      analysis,
      analysisQuestions,
      existingReport
    );

    if (publishedQuestions.length === 0) {
      return {
        success: false,
        error: "No questions could be added to the question bank",
      };
    }

    const questionIds = publishedQuestions.map((entry) => entry.promptId);
    const report = await savePendingReport(
      ports,
      examAnalysisId,
      publishedBy,
      analysis,
      existingReport,
      questionIds
    );

    for (const { question, promptId } of publishedQuestions) {
      const questionText = String(question.questionText);
      const normalizedText = normalizeQuestionText(questionText);

      await ports.findOrCreateUnique({
        questionText,
        normalizedText,
        subject: analysis.subjectName,
        subjectCode: analysis.subjectCode,
        topics: Array.isArray(question.keywords)
          ? question.keywords.filter((keyword): keyword is string => typeof keyword === "string")
          : [],
        keywords: [],
        topicsCovered: [],
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

    const analysisAlreadyPublished =
      analysis.status === "published" || analysis.isPublished === true;

    if (!analysisAlreadyPublished) {
      const updated = await ports.updateAnalysis(examAnalysisId, {
        status: "published",
        isPublished: true,
        publishedAt: new Date(),
      });

      if (!updated || updated.success !== true) {
        return {
          success: false,
          error: updated?.error || "Failed to mark analysis published",
        };
      }
    }

    await ports.addReportToSubject(report._id, analysis.subjectName, analysis.subjectCode);

    // Complete is last. Anything earlier leaves the report pending so a retry
    // can resume instead of being told the analysis is already published.
    await ports.updateReport(report._id, {
      publishStatus: "complete",
      isPublic: true,
      questionIds,
      totalQuestions: questionIds.length,
    });

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

async function collectPublishedQuestions(
  ports: PublishAnalysisPorts,
  examAnalysisId: string,
  publishedBy: string,
  analysis: PublishableAnalysis,
  analysisQuestions: PublishableQuestion[],
  existingReport: StoredReport | null
): Promise<CreatedPrompt<PublishableQuestion>[]> {
  const savedPromptIds = existingReport?.questionIds ?? [];

  if (savedPromptIds.length > 0) {
    const promptTextById = new Map<string, string | null>();
    for (const promptId of savedPromptIds) {
      const prompt = await ports.findPrompt(promptId);
      promptTextById.set(promptId, prompt?.questionText ?? null);
    }

    const { paired, unmatched } = pairPublishedQuestions(
      analysisQuestions,
      savedPromptIds,
      promptTextById
    );

    let published = paired;
    for (const question of unmatched) {
      published = await appendPromptForQuestion(
        ports,
        published,
        question,
        analysis,
        examAnalysisId,
        publishedBy
      );
    }
    return published;
  }

  let published: CreatedPrompt<PublishableQuestion>[] = [];
  for (const question of analysisQuestions) {
    published = await appendPromptForQuestion(
      ports,
      published,
      question,
      analysis,
      examAnalysisId,
      publishedBy
    );
  }
  return published;
}

async function appendPromptForQuestion(
  ports: PublishAnalysisPorts,
  published: CreatedPrompt<PublishableQuestion>[],
  question: PublishableQuestion,
  analysis: PublishableAnalysis,
  examAnalysisId: string,
  publishedBy: string
): Promise<CreatedPrompt<PublishableQuestion>[]> {
  const promptData = buildPromptPayload(question, {
    subject: analysis.subjectName,
    source: analysis.originalFile?.fileName,
  });

  if (!promptData) {
    console.warn(`Skipping question with empty text in analysis ${examAnalysisId}`);
    return published;
  }

  const result = await ports.createPrompt({
    ...promptData,
    subject: promptData.subject ?? analysis.subjectName,
    createdBy: publishedBy,
  });

  if (!result.success || !result.promptId) {
    console.error(
      `Failed to create prompt for a question in analysis ${examAnalysisId}: ${result.error}`
    );
    return published;
  }

  return appendCreatedPrompt(published, question, result as PromptCreateResult);
}

async function savePendingReport(
  ports: PublishAnalysisPorts,
  examAnalysisId: string,
  publishedBy: string,
  analysis: PublishableAnalysis,
  existingReport: StoredReport | null,
  questionIds: string[]
): Promise<StoredReport> {
  if (existingReport) {
    await ports.updateReport(existingReport._id, {
      publishStatus: "pending",
      questionIds,
      totalQuestions: questionIds.length,
    });
    return { ...existingReport, questionIds, publishStatus: "pending" };
  }

  const reportData: AnalysisReport = {
    examAnalysisId,
    subjectCode: analysis.subjectCode,
    subjectName: analysis.subjectName,
    branch: analysis.branch,
    year: analysis.year,
    semester: analysis.semester,
    examType: analysis.examType,
    questionIds,
    totalQuestions: questionIds.length,
    totalMarks: analysis.totalMarks,
    bloomDistribution: sanitizeBloomDistribution(analysis.bloomDistribution),
    overallAssessment: analysis.overallAssessment,
    originalFileName: analysis.originalFile?.fileName ?? analysis.subjectName,
    originalFileUrl: analysis.originalFile?.fileUrl,
    publishedBy,
    publishedAt: new Date(),
    tags: analysis.tags || [],
    viewCount: 0,
    // Hidden until unique questions and the analysis status flip succeed.
    isPublic: false,
    publishStatus: "pending",
  };

  return ports.createReport(reportData);
}
