import type { Model } from "mongoose";

import {
  getQuestionModel,
  getExamModel,
  getUserModel,
  getExamSubmissionModel,
  getPromptModel,
  getExamQuestionModel,
  getSubjectModel as getLegacySubjectModel,
  getJobMetadataModel,
  getUploadSessionModel,
} from "./mongooseSchemas";
import {
  getAnalysisReportModel,
  getExamAnalysisModel,
  getPastPaperModel,
  getSyllabusModel,
  getUniqueQuestionModel,
  getSubjectModel,
} from "./newFeatureModels";
import { findDuplicatePhysicalCollections, MANAGED_COLLECTION_NAMES } from "./managedCollections";
import type { ManagedCollectionName } from "./managedCollections";
import { getExamAttemptModel } from "./repositories/ExamAttemptRepository";

export interface ManagedCollection {
  name: ManagedCollectionName;
  model: Model<any>;
}

const MODEL_FACTORIES: Record<ManagedCollectionName, () => Model<any>> = {
  questions: getQuestionModel,
  examSets: getExamModel,
  user: getUserModel,
  ExamSubmission: getExamSubmissionModel,
  Prompt: getPromptModel,
  ExamQuestion: getExamQuestionModel,
  subjects: getLegacySubjectModel,
  JobMetadata: getJobMetadataModel,
  UploadSession: getUploadSessionModel,
  AnalysisReport: getAnalysisReportModel,
  ExamAnalysis: getExamAnalysisModel,
  PastPaper: getPastPaperModel,
  Syllabus: getSyllabusModel,
  UniqueQuestion: getUniqueQuestionModel,
  Subject: getSubjectModel,
  examAttempts: getExamAttemptModel,
};

/**
 * Resolve every managed collection to its mongoose model.
 *
 * The lazy model getters are only invoked when a caller asks for a collection,
 * so an unknown key in `MANAGED_COLLECTION_NAMES` fails loudly here instead of
 * silently skipping a collection during truncate/backup.
 */
export function getManagedCollections(): ManagedCollection[] {
  const collections = MANAGED_COLLECTION_NAMES.map((name) => ({
    name,
    model: MODEL_FACTORIES[name](),
  }));

  const duplicates = findDuplicatePhysicalCollections(
    collections.map(({ name, model }) => ({
      name,
      collectionName: model.collection.collectionName,
    }))
  );
  if (duplicates.length > 0) {
    throw new Error(
      `Managed collection registry maps multiple entries onto one MongoDB collection: ${duplicates.join("; ")}`
    );
  }

  return collections;
}

/**
 * Get the names of every collection the registry is expected to manage.
 * Exposed for callers that only need the list (logging, tests).
 */
export function getManagedCollectionNames(): ManagedCollectionName[] {
  return [...MANAGED_COLLECTION_NAMES];
}
