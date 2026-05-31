import { Model } from "mongoose";
import { getAnalysisReportModel } from "../newFeatureModels";
import type { AnalysisReport, AnalysisReportWithId } from "../schemas/index";
import { connect } from "../connect";

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
  async create(reportData: AnalysisReport): Promise<AnalysisReportWithId> {
    await connect();
    const report = await this.model.create(reportData);
    return {
      ...report.toObject(),
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
    const query: any = { subjectName, isPublic: true };
    
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
   * Get all reports with optional filters
   */
  async findAll(filters?: {
    subjectCode?: string;
    year?: string;
    semester?: string;
    examType?: "main" | "kt";
    branch?: string;
  }): Promise<AnalysisReportWithId[]> {
    const query: any = { isPublic: true };
    
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
   */
  async getSubjectsSummary(): Promise<Array<{
    subjectName: string;
    subjectCode?: string;
    branch?: string;
    reportCount: number;
    years: string[];
    latestYear: string;
  }>> {
    await connect();
    const results = await this.model.aggregate([
      { $match: { isPublic: true } },
      {
        $group: {
          _id: {
            subjectName: "$subjectName",
            subjectCode: "$subjectCode",
            branch: "$branch",
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
          reportCount: 1,
          years: 1,
          latestYear: 1,
        },
      },
      { $sort: { subjectName: 1 } },
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
      .find({ isPublic: true })
      .sort({ publishedAt: -1 })
      .limit(limit)
      .lean();
    
    return reports.map(report => ({
      ...report,
      _id: report._id.toString(),
    }));
  }
}
