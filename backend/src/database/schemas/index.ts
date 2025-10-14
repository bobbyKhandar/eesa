//barrel exporting all the types 

export type { Exam } from "./examSchemaZod";
export type { User } from "./userSchemaZod";
export type { Subject } from "./subjectSchemaZod";
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