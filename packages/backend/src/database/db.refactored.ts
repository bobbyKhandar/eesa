/**
 * Database Operations Facade (Legacy Compatibility Layer)
 * 
 * This file maintains backward compatibility by exposing the same function signatures
 * as before, but now delegates to the new repository classes internally.
 * 
 * For new code, prefer using repositories directly:
 * import { promptRepo, examRepo } from './repositories/index.js';
 * 
 * This facade is only for maintaining compatibility with existing code.
 */

import { 
  PromptRepository,
  ExamQuestionRepository,
  ExamRepository,
  ExamSubmissionRepository
} from './repositories/index.js';

// Initialize repository instances
const promptRepo = new PromptRepository();
const examQuestionRepo = new ExamQuestionRepository();
const examRepo = new ExamRepository();
const submissionRepo = new ExamSubmissionRepository();

// ============================================================================
// LEGACY FUNCTIONS - Maintained for backward compatibility
// ============================================================================

// Re-export old Question/Exam operations (keeping for legacy code)
// Note: Legacy functions available in db.ts for now
// export { 
//   createExam,
//   getUserExams,
//   getQuestions,
//   getExamSetData,
//   getUserIdByEmail,
//   submitExam,
//   getExamSubmission,
//   getAllExamSubmissions,
//   getUsersExamSubmissions,
//   getUserSubmissionHistory
// } from './db.legacy.js';

// ============================================================================
// NEW SCHEMA OPERATIONS - Prompt Repository
// ============================================================================

export async function createPrompt(promptData: Parameters<typeof promptRepo.create>[0]) {
  return promptRepo.create(promptData);
}

export async function createPromptsBulk(promptsData: Parameters<typeof promptRepo.createBulk>[0]) {
  return promptRepo.createBulk(promptsData);
}

export async function getPromptById(promptId: string) {
  return promptRepo.getById(promptId);
}

export async function searchPrompts(filters: Parameters<typeof promptRepo.search>[0]) {
  return promptRepo.search(filters);
}

export async function getLowConfidenceOcrPrompts(threshold?: number, limit?: number) {
  return promptRepo.getLowConfidenceOcr(threshold, limit);
}

export async function updatePrompt(promptId: string, updates: Parameters<typeof promptRepo.update>[1]) {
  return promptRepo.update(promptId, updates);
}

export async function getPromptsBySource(source: string) {
  return promptRepo.getBySource(source);
}

// ============================================================================
// NEW SCHEMA OPERATIONS - ExamQuestion Repository
// ============================================================================

export async function createExamQuestion(examQuestionData: Parameters<typeof examQuestionRepo.create>[0]) {
  return examQuestionRepo.create(examQuestionData);
}

export async function createExamQuestionsBulk(examQuestionsData: Parameters<typeof examQuestionRepo.createBulk>[0]) {
  return examQuestionRepo.createBulk(examQuestionsData);
}

export async function getExamQuestionWithPrompt(examQuestionId: string) {
  return examQuestionRepo.getWithPrompt(examQuestionId);
}

export async function getExamQuestionsWithPrompts(examQuestionIds: string[]) {
  return examQuestionRepo.getManyWithPrompts(examQuestionIds);
}

export async function getExamsUsingPrompt(promptId: string) {
  return examQuestionRepo.getExamsUsingPrompt(promptId);
}

// ============================================================================
// NEW SCHEMA OPERATIONS - Exam Repository
// ============================================================================

export async function createExamWithPrompts(examData: Parameters<typeof examRepo.createWithPrompts>[0]) {
  return examRepo.createWithPrompts(examData);
}

export async function getExamWithFullDetails(examId: string) {
  return examRepo.getWithFullDetails(examId);
}

export async function assignExamToUsers(examId: string, userIds: string[]) {
  return examRepo.assignToUsers(examId, userIds);
}

// ============================================================================
// NEW SCHEMA OPERATIONS - ExamSubmission Repository
// ============================================================================
// Note: ExamSubmission now only handles COMPLETED submissions

export async function createExamSubmission(data: Parameters<typeof submissionRepo.create>[0]) {
  return submissionRepo.create(data);
}

export async function updateSubmissionResponses(
  submissionId: string,
  responses: Parameters<typeof submissionRepo.updateResponses>[1],
  marksAchieved: Parameters<typeof submissionRepo.updateResponses>[2],
  evaluatorObservations?: Parameters<typeof submissionRepo.updateResponses>[3]
) {
  return submissionRepo.updateResponses(submissionId, responses, marksAchieved, evaluatorObservations);
}

// ============================================================================
// RECOMMENDED APPROACH - Export repositories directly
// ============================================================================

// For new code, use repositories directly instead of these wrapper functions
export {
  PromptRepository,
  ExamQuestionRepository,
  ExamRepository,
  ExamSubmissionRepository
};

// Singleton instances for convenience
export {
  promptRepo,
  examQuestionRepo,
  examRepo,
  submissionRepo
};
