//barrel exporting all the types 

export type { Exam } from "./examSchemaZod.js";
export type { User } from "./userSchemaZod.js";
export type { Subject as OldSubject } from "./subjectSchemaZod.js"; // Legacy subject type
export type { Question } from "./questionSchemaZod.js";
export type { Prompt } from "./promptSchemaZod.js";

export { promptZodSchema } from "./promptSchemaZod.js";

// Export exam submission related types
export type {
  QuestionEvaluation,
  ExamSubmissionDocument,
  ExamSubmission,
  ClientQuestion,
  TransformedExam,
  SubmitExamRequest,
  SubmitExamResponse,
  GetUserExamsResponse
} from "./examSubmissionZod.js";

// Export schemas for validation
export {
  questionEvaluationZodSchema,
  examSubmissionDocumentZodSchema,
  examSubmissionZodSchema,
  clientQuestionZodSchema,
  transformedExamZodSchema,
  submitExamRequestZodSchema,
  submitExamResponseZodSchema,
  getUserExamsResponseZodSchema
} from "./examSubmissionZod.js";

// ========== NEW FEATURE SCHEMAS ==========

// Subject Management (Enhanced)
export type {
  SubjectTopic,
  LearningOutcome,
  AssessmentStructure,
  Textbook,
  SubjectDocument,
  Subject,
} from "./subjectZod.js";

export {
  subjectTopicZodSchema,
  learningOutcomeZodSchema,
  assessmentStructureZodSchema,
  textbookZodSchema,
  subjectDocumentZodSchema,
  subjectZodSchema,
  subjectSchemaOptions,
} from "./subjectZod.js";

// Syllabus Management
export type {
  SyllabusTopic,
  SyllabusModule,
  FileAttachment,
  SyllabusDocument,
  Syllabus,
} from "./syllabusZod.js";

export {
  syllabusTopicZodSchema,
  syllabusModuleZodSchema,
  fileAttachmentZodSchema,
  syllabusDocumentZodSchema,
  syllabusZodSchema,
  syllabusSchemaOptions,
} from "./syllabusZod.js";

// Past Papers
export type {
  PastPaperQuestion,
  PastPaperDocument,
  PastPaper,
} from "./pastPaperZod.js";

export {
  pastPaperQuestionZodSchema,
  pastPaperDocumentZodSchema,
  pastPaperZodSchema,
  pastPaperSchemaOptions,
} from "./pastPaperZod.js";

// Exam Analysis (AI-powered)
export type {
  AnalyzedQuestion,
  SyllabusCoverage,
  PastPaperComparison,
  BloomDistribution,
  ExamAnalysisDocument,
  ExamAnalysis,
  CreateExamAnalysisRequest,
  UpdateExamAnalysisRequest,
} from "./examAnalysisZod.js";

export {
  analyzedQuestionZodSchema,
  syllabusCoverageZodSchema,
  pastPaperComparisonZodSchema,
  bloomDistributionZodSchema,
  examAnalysisDocumentZodSchema,
  examAnalysisZodSchema,
  examAnalysisSchemaOptions,
  createExamAnalysisRequestZodSchema,
  updateExamAnalysisRequestZodSchema,
} from "./examAnalysisZod.js";

// Analysis Reports (Published Question Banks)
export type {
  AnalysisReport,
  AnalysisReportInput,
  AnalysisReportWithId,
} from "./analysisReportZod.js";

export {
  analysisReportZodSchema,
  analysisReportWithIdZodSchema,
  analysisReportSchemaOptions,
} from "./analysisReportZod.js";

// Unique Questions (Deduplicated Question Bank)
export type {
  UniqueQuestion,
  UniqueQuestionInsert,
} from "./uniqueQuestionZod.js";

export {
  uniqueQuestionZod,
  uniqueQuestionInsertZod,
} from "./uniqueQuestionZod.js";