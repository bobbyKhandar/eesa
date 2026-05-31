import { getUniqueQuestionModel } from "../newFeatureModels";
import type { UniqueQuestion, UniqueQuestionInsert } from "../schemas/index";

export class UniqueQuestionRepository {
  private model = getUniqueQuestionModel();

  /**
   * Find or create a unique question
   * Returns existing question if found (based on normalized text and subject)
   */
  async findOrCreate(data: UniqueQuestionInsert & { 
    analysisReportId: string;
    year: string;
    semester: string;
    examType: "main" | "kt";
  }): Promise<{ question: any; isNew: boolean }> {
    const existing = await this.model.findOne({
      normalizedText: data.normalizedText,
      subject: data.subject,
    });

    if (existing) {
      // Update existing question
      const updatedQuestion = await this.model.findByIdAndUpdate(
        existing._id,
        {
          $addToSet: {
            sourceReports: data.analysisReportId,
            promptIds: { $each: data.promptIds || [] },
            appearances: {
              year: data.year,
              semester: data.semester,
              examType: data.examType,
              analysisReportId: data.analysisReportId,
            },
          },
          $inc: { occurrenceCount: 1 },
          $set: { 
            lastSeenAt: new Date(),
            updatedAt: new Date(),
          },
        },
        { new: true }
      );

      return { question: updatedQuestion, isNew: false };
    }

    // Create new unique question
    const newQuestion = await this.model.create({
      ...data,
      sourceReports: [data.analysisReportId],
      appearances: [{
        year: data.year,
        semester: data.semester,
        examType: data.examType,
        analysisReportId: data.analysisReportId,
      }],
      occurrenceCount: 1,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    });

    return { question: newQuestion, isNew: true };
  }

  /**
   * Get all unique questions for a subject
   */
  async findBySubject(
    subject: string,
    options?: {
      bloomsLevel?: string;
      minOccurrence?: number;
      sortBy?: "occurrenceCount" | "firstSeenAt" | "lastSeenAt";
      sortOrder?: "asc" | "desc";
      includeInactive?: boolean;
    }
  ) {
    const query: any = { subject };
    
    // Only filter by isActive if not explicitly including inactive
    if (!options?.includeInactive) {
      query.isActive = true;
    }

    if (options?.bloomsLevel) {
      query.bloomsLevel = options.bloomsLevel;
    }

    if (options?.minOccurrence) {
      query.occurrenceCount = { $gte: options.minOccurrence };
    }

    const sortField = options?.sortBy || "occurrenceCount";
    const sortOrder = options?.sortOrder === "asc" ? 1 : -1;
    
    console.log("Querying UniqueQuestions with:", query);
    const results = await this.model
      .find(query)
      .sort({ [sortField]: sortOrder })
      .lean();
    
    console.log(`Found ${results.length} questions for subject "${subject}"`);
    if (results.length > 0) {
      console.log("Sample question:", {
        text: results[0].text?.substring(0, 100),
        subject: results[0].subject,
        isActive: results[0].isActive
      });
    }

    return results;
  }

  /**
   * Get unique question by ID
   */
  async findById(id: string) {
    return this.model.findById(id).lean();
  }

  /**
   * Get statistics for a subject
   */
  async getSubjectStats(subject: string) {
    const stats = await this.model.aggregate([
      { $match: { subject, isActive: true } },
      {
        $group: {
          _id: null,
          totalUniqueQuestions: { $sum: 1 },
          totalOccurrences: { $sum: "$occurrenceCount" },
          avgOccurrence: { $avg: "$occurrenceCount" },
          bloomsDistribution: {
            $push: "$bloomsLevel",
          },
        },
      },
    ]);

    if (!stats.length) {
      return {
        totalUniqueQuestions: 0,
        totalOccurrences: 0,
        avgOccurrence: 0,
        bloomsDistribution: {},
      };
    }

    // Count blooms distribution
    const bloomsCounts: Record<string, number> = {};
    stats[0].bloomsDistribution.forEach((level: string) => {
      if (level) {
        bloomsCounts[level] = (bloomsCounts[level] || 0) + 1;
      }
    });

    return {
      totalUniqueQuestions: stats[0].totalUniqueQuestions,
      totalOccurrences: stats[0].totalOccurrences,
      avgOccurrence: Math.round(stats[0].avgOccurrence * 10) / 10,
      bloomsDistribution: bloomsCounts,
    };
  }

  /**
   * Get most frequent questions
   */
  async getMostFrequent(subject: string, limit: number = 10) {
    return this.model
      .find({ subject, isActive: true })
      .sort({ occurrenceCount: -1 })
      .limit(limit)
      .lean();
  }

  /**
   * Search questions by text
   */
  async searchByText(subject: string, searchText: string) {
    return this.model
      .find({
        subject,
        isActive: true,
        $or: [
          { questionText: { $regex: searchText, $options: "i" } },
          { normalizedText: { $regex: searchText, $options: "i" } },
        ],
      })
      .sort({ occurrenceCount: -1 })
      .lean();
  }

  /**
   * Update embedding (for future FAISS integration)
   */
  async updateEmbedding(id: string, embedding: number[]) {
    return this.model.findByIdAndUpdate(
      id,
      { embedding, updatedAt: new Date() },
      { new: true }
    );
  }

  /**
   * Update cluster ID (for future HDBSCAN integration)
   */
  async updateClusterId(id: string, clusterId: string) {
    return this.model.findByIdAndUpdate(
      id,
      { clusterId, updatedAt: new Date() },
      { new: true }
    );
  }

  /**
   * Get all questions without embeddings (for batch processing)
   */
  async findWithoutEmbeddings(limit?: number) {
    const query = this.model.find({
      isActive: true,
      embedding: { $exists: false },
    });

    if (limit) {
      query.limit(limit);
    }

    return query.lean();
  }

  /**
   * Get all unique subjects that have questions
   */
  async getAllSubjects() {
    // Check both with and without isActive filter
    const activeSubjects = await this.model.distinct("subject", { isActive: true });
    const allSubjects = await this.model.distinct("subject");
    const totalCount = await this.model.countDocuments();
    const activeCount = await this.model.countDocuments({ isActive: true });
    
    console.log("UniqueQuestions stats:", {
      totalQuestions: totalCount,
      activeQuestions: activeCount,
      allSubjects: allSubjects,
      activeSubjects: activeSubjects
    });
    
    return allSubjects; // Return all subjects to see what's there
  }

  /**
   * Delete unique question
   */
  async delete(id: string) {
    return this.model.findByIdAndUpdate(
      id,
      { isActive: false, updatedAt: new Date() },
      { new: true }
    );
  }
}
