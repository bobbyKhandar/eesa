import { getUniqueQuestionModel } from "../newFeatureModels.js";
import type { UniqueQuestionInsert } from "../schemas/index.js";
import { identityWriteAttempts, isDuplicateKeyError } from "../uniqueQuestionDedup.js";
import {
  UNIQUE_QUESTION_PAGE_PROJECTION,
  InvalidQuestionBankCursorError,
  clampPyqLimit,
  decodeQuestionBankCursor,
  encodeQuestionBankCursor,
  questionBankPageFilter,
  type QuestionBankPage,
} from "../../services/questionBankPage.js";

interface SubjectListOptions {
  bloomsLevel?: string;
  minOccurrence?: number;
  sortBy?: "occurrenceCount" | "firstSeenAt" | "lastSeenAt";
  sortOrder?: "asc" | "desc";
  includeInactive?: boolean;
}

interface SubjectPageOptions extends SubjectListOptions {
  limit: number;
  cursor?: string | null;
}

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

function readUpsertResult(result: unknown): { question: unknown; isNew: boolean } | null {
  if (!result || typeof result !== "object" || !("value" in result)) return null;
  const record = result as {
    value?: unknown;
    lastErrorObject?: { updatedExisting?: boolean; upserted?: unknown };
  };
  if (record.value == null) return null;
  const info = record.lastErrorObject;
  const isNew = info?.updatedExisting === false || info?.upserted != null;
  return { question: record.value, isNew };
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
   * Upsert a unique question and link it to one analysis report.
   *
   * The write is one atomic upsert on `normalizedText` + `subject`. A
   * duplicate-key error means another publisher inserted that pair; the call
   * retries against the stored row. Repeating the call for the same report
   * (a publication retry) does not increment `occurrenceCount` or duplicate
   * the appearance. A different report still counts as another occurrence.
   */
  async findOrCreate(data: UniqueQuestionInsert & {
    analysisReportId: string;
    year: string;
    semester: string;
    examType: "main" | "kt";
  }): Promise<{ question: any; isNew: boolean }> {
    const now = new Date();
    const appearance = {
      year: data.year,
      semester: data.semester,
      examType: data.examType,
      analysisReportId: data.analysisReportId,
    };
    const promptIds = data.promptIds || [];

    const insert: Record<string, unknown> = {
      questionText: data.questionText,
      normalizedText: data.normalizedText,
      subject: data.subject,
      topics: data.topics ?? [],
      tags: data.tags ?? [],
      isVerified: data.isVerified ?? false,
      isActive: data.isActive ?? true,
      sourceReports: [],
      promptIds: [],
      appearances: [],
      // Schema default is 1. $inc below is the only increment, including on insert.
      occurrenceCount: 0,
      firstSeenAt: data.firstSeenAt ?? now,
      lastSeenAt: now,
    };
    if (data.subjectCode !== undefined) insert.subjectCode = data.subjectCode;
    if (data.bloomsLevel !== undefined) insert.bloomsLevel = data.bloomsLevel;
    if (data.estimatedMarks !== undefined) insert.estimatedMarks = data.estimatedMarks;

    const identity = {
      normalizedText: data.normalizedText,
      subject: data.subject,
    };
    const linkFilter = {
      ...identity,
      sourceReports: { $ne: data.analysisReportId },
    };
    const linkUpdate = {
      $addToSet: {
        sourceReports: data.analysisReportId,
        promptIds: { $each: promptIds },
        appearances: appearance,
      },
      $inc: { occurrenceCount: 1 },
      $set: {
        lastSeenAt: now,
        updatedAt: now,
      },
    };

    for (let attempt = 0; attempt < identityWriteAttempts(); attempt += 1) {
      try {
        const written: unknown = await this.model.findOneAndUpdate(
          linkFilter,
          { $setOnInsert: insert, ...linkUpdate },
          // setDefaultsOnInsert would also write occurrenceCount: 1, and $inc
          // would turn the first sighting into 2.
          { upsert: true, new: true, setDefaultsOnInsert: false, includeResultMetadata: true }
        );
        const parsed = readUpsertResult(written);
        if (parsed) return parsed;
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;

        const linked = await this.model.findOneAndUpdate(linkFilter, linkUpdate, { new: true });
        if (linked) return { question: linked, isNew: false };

        // This report is already on the row that won the insert.
        const existing = await this.model.findOneAndUpdate(
          { ...identity, sourceReports: data.analysisReportId },
          {
            $addToSet: { promptIds: { $each: promptIds } },
            $set: { updatedAt: now },
          },
          { new: true }
        );
        if (existing) return { question: existing, isNew: false };
      }
    }

    const raced = await this.model.findOne(identity);
    if (raced) return { question: raced, isNew: false };

    throw new Error("Unique question was not stored");
  }

  /**
   * Active unique questions for a subject, without embedding vectors.
   * Callers that render the resource bank pass `limit` (and optionally
   * `cursor`) and receive one page. Other callers still receive the list.
   */
  async findBySubject(
    subject: string,
    options?: SubjectListOptions,
  ): Promise<Record<string, unknown>[]>;
  async findBySubject(subject: string, options: SubjectPageOptions): Promise<QuestionBankPage>;
  async findBySubject(
    subject: string,
    options?: SubjectListOptions & { limit?: number; cursor?: string | null },
  ): Promise<Record<string, unknown>[] | QuestionBankPage> {
    if (typeof options?.limit === "number") {
      return this.findSubjectPage(subject, options as SubjectPageOptions);
    }

    const query: Record<string, unknown> = { subject };

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
      .select({ embedding: 0 })
      .sort({ [sortField]: sortOrder })
      .lean();

    return results as Record<string, unknown>[];
  }

  /**
   * One page of active questions, occurrence count descending.
   * The query projects the resource fields and does not load embeddings.
   * An unusable cursor throws before the query runs.
   */
  private async findSubjectPage(subject: string, options: SubjectPageOptions): Promise<QuestionBankPage> {
    const rawCursor = typeof options.cursor === "string" ? options.cursor.trim() : "";
    const decoded = rawCursor ? decodeQuestionBankCursor(rawCursor) : null;
    if (decoded && decoded.kind !== "question") {
      throw new InvalidQuestionBankCursorError();
    }

    const limit = clampPyqLimit(options.limit);
    const minOccurrence = toFiniteInt(options.minOccurrence, 1, Number.MAX_SAFE_INTEGER);
    const rows = await this.model
      .find(
        questionBankPageFilter(subject, decoded && decoded.kind === "question" ? decoded : null, {
          includeInactive: options.includeInactive,
          bloomsLevel: options.bloomsLevel,
          minOccurrence,
        }),
      )
      .select(UNIQUE_QUESTION_PAGE_PROJECTION)
      .sort({ occurrenceCount: -1, _id: -1 })
      .limit(limit + 1)
      .lean();

    const stored = rows as Array<{ _id?: unknown; occurrenceCount?: unknown }>;
    const hasMore = stored.length > limit;
    const questions = hasMore ? stored.slice(0, limit) : stored;
    const last = questions[questions.length - 1];
    const lastId = last?._id == null ? "" : String(last._id);
    const occurrenceCount =
      typeof last?.occurrenceCount === "number" &&
      Number.isInteger(last.occurrenceCount) &&
      last.occurrenceCount >= 0
        ? last.occurrenceCount
        : 0;
    const nextCursor =
      hasMore && /^[a-f0-9]{24}$/i.test(lastId)
        ? encodeQuestionBankCursor({ kind: "question", occurrenceCount, id: lastId })
        : null;

    return {
      questions: questions as Array<Record<string, unknown>>,
      nextCursor,
    };
  }

  /**
   * Get unique question id by ID
   */
  async findById(id: string) {
    return this.model.findById(id).lean();
  }

  /**
   * Active question count per subject, keyed by subject name.
   *
 * Single aggregate so the resource library can report real question counts
   * alongside the subjects list instead of one query per subject.
   */
  async getQuestionCountsBySubject(): Promise<Record<string, number>> {
    const rows = await this.model.aggregate([
      { $match: { isActive: true, subject: { $type: "string" } } },
      { $group: { _id: "$subject", count: { $sum: 1 } } },
    ]);

    const counts: Record<string, number> = {};
    for (const row of rows) {
      counts[row._id] = row.count;
    }
    return counts;
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
