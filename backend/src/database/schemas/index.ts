//barrel exporting all the types 

export type { Exam } from "./examSchemaZod";
export type { User } from "./userSchemaZod";
export type { Subject as OldSubject } from "./subjectSchemaZod"; // Legacy subject type
export type { Question } from "./questionSchemaZod";

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
} from "./examSubmissionZod";

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
} from "./examSubmissionZod";

// ========== NEW FEATURE SCHEMAS ==========

// Subject Management (Enhanced)
export type {
  SubjectTopic,
  LearningOutcome,
  AssessmentStructure,
  Textbook,
  SubjectDocument,
  Subject,
} from "./subjectZod";

export {
  subjectTopicZodSchema,
  learningOutcomeZodSchema,
  assessmentStructureZodSchema,
  textbookZodSchema,
  subjectDocumentZodSchema,
  subjectZodSchema,
  subjectSchemaOptions,
} from "./subjectZod";

// Syllabus Management
export type {
  SyllabusTopic,
  SyllabusModule,
  FileAttachment,
  SyllabusDocument,
  Syllabus,
} from "./syllabusZod";

export {
  syllabusTopicZodSchema,
  syllabusModuleZodSchema,
  fileAttachmentZodSchema,
  syllabusDocumentZodSchema,
  syllabusZodSchema,
  syllabusSchemaOptions,
} from "./syllabusZod";

// Past Papers
export type {
  PastPaperQuestion,
  PastPaperDocument,
  PastPaper,
} from "./pastPaperZod";

export {
  pastPaperQuestionZodSchema,
  pastPaperDocumentZodSchema,
  pastPaperZodSchema,
  pastPaperSchemaOptions,
} from "./pastPaperZod";

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
} from "./examAnalysisZod";

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
} from "./examAnalysisZod";

// Analysis Reports (Published Question Banks)
export type {
  AnalysisReport,
  AnalysisReportWithId,
} from "./analysisReportZod";

export {
  analysisReportZodSchema,
  analysisReportWithIdZodSchema,
  analysisReportSchemaOptions,
} from "./analysisReportZod";

// Unique Questions (Deduplicated Question Bank)
export type {
  UniqueQuestion,
  UniqueQuestionInsert,
} from "./uniqueQuestionZod";

export {
  uniqueQuestionZod,
  uniqueQuestionInsertZod,
} from "./uniqueQuestionZod";