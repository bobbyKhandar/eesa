import { getExamAnalysisModel } from "../newFeatureModels";
import type { ExamAnalysisDocument, ExamAnalysis } from "../schemas/examAnalysisZod";

export class ExamAnalysisRepository {
  private model = getExamAnalysisModel();

  /**
   * Create a new exam analysis
   */
  async create(analysisData: ExamAnalysisDocument) {
    try {
      const analysis = await this.model.create(analysisData);
      return {
        success: true,
        analysis: this.toPlainObject(analysis),
        analysisId: analysis._id.toString(),
      };
    } catch (error: any) {
      console.error("Error creating exam analysis:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get analysis by ID
   */
  async getById(analysisId: string) {
    try {
      const analysis = await this.model.findById(analysisId);
      if (!analysis) {
        return null;
      }
      return this.toPlainObject(analysis);
    } catch (error) {
      console.error("Error fetching analysis:", error);
      return null;
    }
  }

  /**
   * Find analysis by ID (alias for getById for compatibility)
   */
  async findById(analysisId: string) {
    return this.getById(analysisId);
  }

  /**
   * Get all analyses by user with filters
   */
  async getByUser(
    userId: string,
    filters: {
      status?: string;
      subjectCode?: string;
      year?: string;
      isPublished?: boolean;
    } = {}
  ) {
    try {
      const query: any = { analyzedBy: userId };

      if (filters.status) query.status = filters.status;
      if (filters.subjectCode) query.subjectCode = filters.subjectCode;
      if (filters.year) query.year = filters.year;
      if (filters.isPublished !== undefined) query.isPublished = filters.isPublished;

      const analyses = await this.model.find(query).sort({ analyzedAt: -1 });
      return analyses.map(a => this.toPlainObject(a));
    } catch (error) {
      console.error("Error fetching user analyses:", error);
      return [];
    }
  }

  /**
   * Update analysis
   */
  async update(analysisId: string, updateData: Partial<ExamAnalysisDocument>) {
    try {
      const analysis = await this.model.findByIdAndUpdate(
        analysisId,
        { $set: updateData },
        { new: true, runValidators: true }
      );

      if (!analysis) {
        return { success: false, error: "Analysis not found" };
      }

      return {
        success: true,
        analysis: this.toPlainObject(analysis),
      };
    } catch (error: any) {
      console.error("Error updating analysis:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Publish analysis
   */
  async publish(analysisId: string, isPublic: boolean = false) {
    try {
      const analysis = await this.model.findByIdAndUpdate(
        analysisId,
        {
          $set: {
            isPublished: true,
            publishedAt: new Date(),
            isPublic,
          },
        },
        { new: true }
      );

      if (!analysis) {
        return { success: false, error: "Analysis not found" };
      }

      return { success: true };
    } catch (error: any) {
      console.error("Error publishing analysis:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Increment view count
   */
  async incrementViewCount(analysisId: string) {
    try {
      await this.model.findByIdAndUpdate(
        analysisId,
        { $inc: { viewCount: 1 } }
      );
      return { success: true };
    } catch (error: any) {
      console.error("Error incrementing view count:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Delete analysis
   */
  async delete(analysisId: string) {
    try {
      const analysis = await this.model.findByIdAndDelete(analysisId);

      if (!analysis) {
        return { success: false, error: "Analysis not found" };
      }

      return { success: true };
    } catch (error: any) {
      console.error("Error deleting analysis:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get public analyses
   */
  async getPublicAnalyses(filters: {
    subjectCode?: string;
    year?: string;
    limit?: number;
  } = {}) {
    try {
      const query: any = {
        isPublic: true,
        isPublished: true,
        status: "completed",
      };

      if (filters.subjectCode) query.subjectCode = filters.subjectCode;
      if (filters.year) query.year = filters.year;

      const limit = filters.limit || 20;

      const analyses = await this.model
        .find(query)
        .sort({ publishedAt: -1 })
        .limit(limit);

      return analyses.map(a => this.toPlainObject(a));
    } catch (error) {
      console.error("Error fetching public analyses:", error);
      return [];
    }
  }

  /**
   * Convert Mongoose document to plain object
   */
  private toPlainObject(doc: any): ExamAnalysis {
    return {
      _id: doc._id.toString(),
      subjectCode: doc.subjectCode,
      subjectName: doc.subjectName,
      branch: doc.branch,
      year: doc.year,
      semester: doc.semester,
      examType: doc.examType,
      originalFile: doc.originalFile,
      status: doc.status,
      processingError: doc.processingError,
      analysisOptions: doc.analysisOptions,
      extractedText: doc.extractedText,
      totalQuestions: doc.totalQuestions,
      totalMarks: doc.totalMarks,
      questions: doc.questions,
      bloomDistribution: doc.bloomDistribution,
      syllabusCoverage: doc.syllabusCoverage,
      pastPaperComparison: doc.pastPaperComparison,
      overallAssessment: doc.overallAssessment,
      recommendations: doc.recommendations,
      strengths: doc.strengths,
      improvements: doc.improvements,
      userNotes: doc.userNotes,
      analyzedBy: doc.analyzedBy,
      analyzedAt: doc.analyzedAt,
      isPublished: doc.isPublished,
      publishedAt: doc.publishedAt,
      viewCount: doc.viewCount,
      isPublic: doc.isPublic,
      sharedWith: doc.sharedWith,
      tags: doc.tags,
    };
  }
}
