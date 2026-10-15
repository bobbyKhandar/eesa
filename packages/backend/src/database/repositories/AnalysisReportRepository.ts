import { Model, type PipelineStage } from "mongoose";
import { getAnalysisReportModel } from "../newFeatureModels.js";
import type { AnalysisReport, AnalysisReportInput, AnalysisReportWithId } from "../schemas/index.js";
import { connect } from "../connect.js";
import { normalizeSubjectSummaries } from "./subjectSummary.js";
import {
  InvalidQuestionBankCursorError,
  clampPyqLimit,
  decodeQuestionBankCursor,
  encodeQuestionBankCursor,
  fallbackPromptIdPipeline,
  fallbackPyqSummaryPipeline,
  readFallbackPyqSummary,
  type FallbackPromptPage,
  type FallbackPyqSummary,
} from "../../services/questionBankPage.js";

/**
 * Question-bank reads hide in-progress publications. A missing `publishStatus`
 * is a legacy report written before the field existed and stays visible.
 */
export function publicAnalysisReportFilter(
  criteria: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ...criteria,
    isPublic: true,
    publishStatus: { $ne: "pending" },
  };
}

/**
 * Repository for Analysis Reports - Published Exam Analysis Question Banks
 */
export class AnalysisReportRepository {
  private model: Model<AnalysisReport>;

  constructor() {
    this.model = getAnalysisReportModel();
  }

  /**
   * Create a new analysis report (publish an exam analysis)
   */
  async create(reportData: AnalysisReportInput): Promise<AnalysisReportWithId> {
    await connect();
    const report = await this.model.create(reportData);
    return {
      ...report.toObject(),
      _id: report._id.toString(),
    };
  }

  /**
   * Patch a report. Used to finish a publication that was left `pending`.
   */
  async update(
    id: string,
    patch: Partial<AnalysisReport>
  ): Promise<AnalysisReportWithId | null> {
    await connect();
    const report = await this.model
      .findByIdAndUpdate(id, { $set: patch }, { new: true })
      .lean();
    if (!report) return null;

    return {
      ...report,
      _id: report._id.toString(),
    };
  }

  /**
   * Find report by ID
   */
  async findById(id: string): Promise<AnalysisReportWithId | null> {
    await connect();
    const report = await this.model.findById(id).lean();
    if (!report) return null;
    
    return {
      ...report,
      _id: report._id.toString(),
    };
  }

  /**
   * Find report by exam analysis ID
   */
  async findByExamAnalysisId(examAnalysisId: string): Promise<AnalysisReportWithId | null> {
    await connect();
    const report = await this.model.findOne({ examAnalysisId }).lean();
    if (!report) return null;
    
    return {
      ...report,
      _id: report._id.toString(),
    };
  }

  /**
   * Find one report by query
   */
  async findOne(query: any): Promise<AnalysisReportWithId | null> {
    await connect();
    const report = await this.model.findOne(query).lean();
    if (!report) return null;
    
    return {
      ...report,
      _id: report._id.toString(),
    };
  }

  /**
   * Get all reports for a subject
   */
  async findBySubject(
    subjectName: string,
    options?: { year?: string; semester?: string; examType?: "main" | "kt" }
  ): Promise<AnalysisReportWithId[]> {
    await connect();
    const query: any = publicAnalysisReportFilter({ subjectName });
    
    if (options?.year) query.year = options.year;
    if (options?.semester) query.semester = options.semester;
    if (options?.examType) query.examType = options.examType;
    
    const reports = await this.model
      .find(query)
      .sort({ year: -1, publishedAt: -1 })
      .lean();
    
    return reports.map(report => ({
      ...report,
      _id: report._id.toString(),
    }));
  }

  /**
   * One page of distinct prompt ids from a subject's public reports.
   * The aggregate returns at most `limit + 1` ids. An unusable cursor throws
   * before the query runs.
   */
  async pagePublicPromptIds(
    subjectName: string,
    options: { limit?: number; cursor?: string | null } = {},
  ): Promise<FallbackPromptPage> {
    const rawCursor = typeof options.cursor === "string" ? options.cursor.trim() : "";
    const decoded = rawCursor ? decodeQuestionBankCursor(rawCursor) : null;
    if (decoded && decoded.kind !== "prompt") throw new InvalidQuestionBankCursorError();

    const limit = clampPyqLimit(options.limit);
    await connect();
    const rows = await this.model.aggregate(
      fallbackPromptIdPipeline(
        publicAnalysisReportFilter({ subjectName }),
        decoded && decoded.kind === "prompt" ? decoded.id : null,
        limit,
      ) as unknown as PipelineStage[],
    );

    const ids = (rows as Array<{ _id?: unknown }>)
      .map((row) => (row?._id == null ? "" : String(row._id)))
      .filter((id) => id.length > 0);
    const hasMore = ids.length > limit;
    const pageIds = hasMore ? ids.slice(0, limit) : ids;
    const last = pageIds[pageIds.length - 1];

    return {
      ids: pageIds,
      nextCursor: hasMore && last ? encodeQuestionBankCursor({ kind: "prompt", id: last }) : null,
    };
  }

  /**
   * Counts, years, and Bloom totals for the fallback question bank.
   * The aggregation does not return report or prompt documents.
   */
  async summarizeFallbackPyqs(
    subjectName: string,
    promptCollection: string,
  ): Promise<FallbackPyqSummary> {
    await connect();
    const rows = await this.model.aggregate(
      fallbackPyqSummaryPipeline(
        publicAnalysisReportFilter({ subjectName }),
        promptCollection,
      ) as unknown as PipelineStage[],
    );
    return readFallbackPyqSummary(rows);
  }

  /**
   * Get all reports with optional filters
   */
  async findAll(filters?: {
    subjectCode?: string;
    year?: string;
    semester?: string;
    examType?: "main" | "kt";
    branch?: string;
  }): Promise<AnalysisReportWithId[]> {
    const query: any = publicAnalysisReportFilter();
    
    if (filters?.subjectCode) query.subjectCode = filters.subjectCode;
    if (filters?.year) query.year = filters.year;
    if (filters?.semester) query.semester = filters.semester;
    if (filters?.examType) query.examType = filters.examType;
    if (filters?.branch) query.branch = filters.branch;
    
    const reports = await this.model
      .find(query)
      .sort({ year: -1, publishedAt: -1 })
      .lean();
    
    return reports.map(report => ({
      ...report,
      _id: report._id.toString(),
    }));
  }

  /**
   * Get unique subjects with their report counts
   *
   * Reports are grouped by subject name only. Grouping by name + code + branch
   * returned one row per (name, code, branch) combination, so the same subject
   * appeared several times in the catalog with duplicate React keys and the
   * "Total Subjects" count was inflated. `subjectCode` / `branch` now come from
   * the most recent report, and `branches` lists every branch for the subject.
   */
  async getSubjectsSummary(): Promise<Array<{
    subjectName: string;
    subjectCode?: string;
    branch?: string;
    branches: string[];
    reportCount: number;
    years: string[];
    latestYear: string;
  }>> {
    await connect();
    const results = await this.model.aggregate([
      { $match: publicAnalysisReportFilter() },
      // Newest report first so $first below picks the current code/branch.
      { $sort: { subjectName: 1, year: -1, publishedAt: -1 } },
      {
        $group: {
          _id: "$subjectName",
          subjectCode: { $first: "$subjectCode" },
          branch: { $first: "$branch" },
          branches: { $addToSet: "$branch" },
          reportCount: { $sum: 1 },
          years: { $addToSet: "$year" },
        },
      },
      {
        $project: {
          _id: 0,
          subjectName: "$_id",
          subjectCode: 1,
          branch: 1,
          branches: 1,
          reportCount: 1,
          years: 1,
        },
      },
    ]);

    return normalizeSubjectSummaries(results as any);
  }

  /**
   * Get subjects grouped by branch *and* semester.
   *
   * `getSubjectsSummary()` groups by (subjectName, subjectCode, branch) only, so
   * a subject published for several semesters comes back as a single row with no
   * semester on it. `/api/resources` then had to invent one, and bucketed every
   * subject in the database under "Semester 1". This variant keeps the semester
   * in the grouping key so the resource library can offer the real one.
   *
   * Kept separate from `getSubjectsSummary()` on purpose: `/api/subjects`
   * reports `subjects.length` as its total and must keep counting one row per
   * subject.
   */
  async getSubjectsBySemesterSummary(): Promise<Array<{
    subjectName: string;
    subjectCode?: string;
    branch?: string;
    semester?: string;
    reportCount: number;
    years: string[];
    latestYear: string;
  }>> {
    await connect();
    const results = await this.model.aggregate([
      { $match: publicAnalysisReportFilter() },
      {
        $group: {
          _id: {
            subjectName: "$subjectName",
            subjectCode: "$subjectCode",
            branch: "$branch",
            semester: "$semester",
          },
          reportCount: { $sum: 1 },
          years: { $addToSet: "$year" },
          latestYear: { $max: "$year" },
        },
      },
      {
        $project: {
          _id: 0,
          subjectName: "$_id.subjectName",
          subjectCode: "$_id.subjectCode",
          branch: "$_id.branch",
          semester: "$_id.semester",
          reportCount: 1,
          years: 1,
          latestYear: 1,
        },
      },
      { $sort: { subjectName: 1, semester: 1 } },
    ]);

    return results;
  }

  /**
   * Increment view count
   */
  async incrementViewCount(id: string): Promise<void> {
    await this.model.findByIdAndUpdate(id, { $inc: { viewCount: 1 } });
  }

  /**
   * Delete report
   */
  async delete(id: string): Promise<boolean> {
    const result = await this.model.findByIdAndDelete(id);
    return result !== null;
  }

  /**
   * Check if report exists for exam analysis
   */
  async existsForExamAnalysis(examAnalysisId: string): Promise<boolean> {
    const count = await this.model.countDocuments({ examAnalysisId });
    return count > 0;
  }

  /**
   * Get recent reports (for homepage/dashboard)
   */
  async getRecentReports(limit: number = 10): Promise<AnalysisReportWithId[]> {
    const reports = await this.model
      .find(publicAnalysisReportFilter())
      .sort({ publishedAt: -1 })
      .limit(limit)
      .lean();
    
    return reports.map(report => ({
      ...report,
      _id: report._id.toString(),
    }));
  }
}
