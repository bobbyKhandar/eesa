/**
 * Repository Index - Export all repositories
 * Single import point for all database repositories
 */

export { PromptRepository } from './PromptRepository.js';
export { ExamQuestionRepository } from './ExamQuestionRepository.js';
export { ExamRepository } from './ExamRepository.js';
export { ExamSubmissionRepository } from './ExamSubmissionRepository.js';
export { UserRepository } from './UserRepository.js';
export { AnalysisReportRepository } from './AnalysisReportRepository.js';
export { UniqueQuestionRepository } from './UniqueQuestionRepository.js';
// Singleton instances for easy access
export const promptRepo = new (await import('./PromptRepository.js')).PromptRepository();
export const examQuestionRepo = new (await import('./ExamQuestionRepository.js')).ExamQuestionRepository();
export const examRepo = new (await import('./ExamRepository.js')).ExamRepository();
export const submissionRepo = new (await import('./ExamSubmissionRepository.js')).ExamSubmissionRepository();
export const userRepo = new (await import('./UserRepository.js')).UserRepository();