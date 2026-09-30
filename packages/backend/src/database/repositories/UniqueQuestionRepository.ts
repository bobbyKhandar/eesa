import { getUniqueQuestionModel } from "../newFeatureModels";
import type { UniqueQuestion, UniqueQuestionInsert } from "../schemas/index";

/** Fields callers are allowed to sort by. */
const SORTABLE_FIELDS = ["occurrenceCount", "firstSeenAt", "lastSeenAt"] as const;

/**
 * Escape user input so it matches literally inside a `$regex` query.
 * Passing it raw makes "(", "*" or ".*" throw a BSONError or scan the whole
 * collection.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toFiniteInt(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const rounded = Math.floor(value);
  if (rounded < min || rounded > max) return undefined;
  return rounded;
}

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

    // NaN here would make Mongo throw ("$gte: NaN"); non-positive values are a
    // no-op filter instead.
    const minOccurrence = toFiniteInt(options?.minOccurrence, 1, Number.MAX_SAFE_INTEGER);
    if (minOccurrence !== undefined) {
      query.occurrenceCount = { $gte: minOccurrence };
    }

    const requestedSort = options?.sortBy as string | undefined;
    const sortField =
      requestedSort && (SORTABLE_FIELDS as readonly string[]).includes(requestedSort)
        ? requestedSort
        : "occurrenceCount";
    const sortOrder = options?.sortOrder === "asc" ? 1 : -1;
    
    const results = await this.model
      .find(query)
      .sort({ [sortField]: sortOrder })
      .lean();
    
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
    const safeLimit = toFiniteInt(limit, 1, 200) ?? 10;

    return this.model
      .find({ subject, isActive: true })
      .sort({ occurrenceCount: -1 })
      .limit(safeLimit)
      .lean();
  }

  /**
   * Search questions by text
   *
   * The search term is escaped so it is matched literally: raw user input lets
   * "(", "*" or ".*" throw a BSONError or turn into a full collection scan.
   */
  async searchByText(subject: string, searchText: string) {
    const pattern = escapeRegExp(String(searchText ?? "").trim());
    if (!pattern) return [];

    return this.model
      .find({
        subject,
        isActive: true,
        $or: [
          { questionText: { $regex: pattern, $options: "i" } },
          { normalizedText: { $regex: pattern, $options: "i" } },
        ],
      })
      .sort({ occurrenceCount: -1 })
      .limit(200)
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
    return this.model.distinct("subject");
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
