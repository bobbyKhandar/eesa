/**
 * In-progress exam attempts.
 *
 * A completed submission lives in ExamSubmissionRepository. This collection
 * records the moment the student actually opened the exam, so the submit
 * route can reject a payload that arrives after the window has closed.
 * The repository comment on submissions calls this out as a separate store.
 */

import mongoose, { type Model } from "mongoose";
import { connect } from "../connect.js";

export interface ExamAttempt {
  examId: string;
  userId: string;
  startedAt: Date;
}

interface ExamAttemptDocument extends ExamAttempt {
  _id: mongoose.Types.ObjectId;
}

const examAttemptSchema = new mongoose.Schema<ExamAttemptDocument>(
  {
    examId: { type: String, required: true },
    userId: { type: String, required: true },
    startedAt: { type: Date, required: true },
  },
  { collection: "examAttempts" },
);

examAttemptSchema.index({ examId: 1, userId: 1 }, { unique: true });

function getExamAttemptModel(): Model<ExamAttemptDocument> {
  return (
    (mongoose.models.ExamAttempt as Model<ExamAttemptDocument> | undefined) ??
    mongoose.model<ExamAttemptDocument>("ExamAttempt", examAttemptSchema)
  );
}

export class ExamAttemptRepository {
  private model: Model<ExamAttemptDocument>;

  constructor() {
    this.model = getExamAttemptModel();
  }

  /**
   * Return the existing attempt, or insert one whose start time is now.
   * Concurrent opens share one row because of the unique (examId, userId) index.
   */
  async open(examId: string, userId: string): Promise<ExamAttempt> {
    await connect();
    const startedAt = new Date();
    const doc = await this.model.findOneAndUpdate(
      { examId, userId },
      { $setOnInsert: { examId, userId, startedAt } },
      { upsert: true, new: true },
    );
    return {
      examId: doc.examId,
      userId: doc.userId,
      startedAt: doc.startedAt,
    };
  }

  async get(examId: string, userId: string): Promise<ExamAttempt | null> {
    await connect();
    const doc = await this.model.findOne({ examId, userId }).lean();
    if (!doc) return null;
    return {
      examId: doc.examId,
      userId: doc.userId,
      startedAt: doc.startedAt,
    };
  }
}
