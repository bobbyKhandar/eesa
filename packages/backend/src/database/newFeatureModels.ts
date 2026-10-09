import mongoose from "mongoose";
import type { Model } from "mongoose";
import type { SubjectDocument, SyllabusDocument, PastPaperDocument, ExamAnalysisDocument, AnalysisReport, UniqueQuestion } from "./schemas/index";
import { zodSchema } from "@zodyac/zod-mongoose";

const { model, models } = mongoose;
import {
  subjectDocumentZodSchema,
  subjectSchemaOptions,
  syllabusDocumentZodSchema,
  syllabusSchemaOptions,
  pastPaperDocumentZodSchema,
  pastPaperSchemaOptions,
  examAnalysisDocumentZodSchema,
  examAnalysisSchemaOptions,
  analysisReportZodSchema,
  analysisReportSchemaOptions,
  uniqueQuestionZod,
} from "./schemas/index";

// Subject Schema
const subjectSchema = zodSchema(subjectDocumentZodSchema, subjectSchemaOptions);

export const getSubjectModel = (): Model<SubjectDocument> => {
  return models["Subject"] || model("Subject", subjectSchema);
};

// Syllabus Schema
const syllabusSchema = zodSchema(syllabusDocumentZodSchema, syllabusSchemaOptions);

export const getSyllabusModel = (): Model<SyllabusDocument> => {
  return models["Syllabus"] || model("Syllabus", syllabusSchema);
};

// Past Paper Schema
const pastPaperSchema = zodSchema(pastPaperDocumentZodSchema, pastPaperSchemaOptions);

export const getPastPaperModel = (): Model<PastPaperDocument> => {
  return models["PastPaper"] || model("PastPaper", pastPaperSchema);
};

// Exam Analysis Schema
const examAnalysisSchema = zodSchema(examAnalysisDocumentZodSchema, examAnalysisSchemaOptions);

export const getExamAnalysisModel = (): Model<ExamAnalysisDocument> => {
  return models["ExamAnalysis"] || model("ExamAnalysis", examAnalysisSchema);
};

// Analysis Report Schema (Published Question Banks)
const analysisReportSchema = zodSchema(analysisReportZodSchema, analysisReportSchemaOptions);

export const getAnalysisReportModel = (): Model<AnalysisReport> => {
  return models["AnalysisReport"] || model("AnalysisReport", analysisReportSchema);
};

// Unique Question Schema (Deduplicated Question Bank)
const uniqueQuestionSchema = zodSchema(uniqueQuestionZod, {
  timestamps: true,
  collection: "uniquequestions",
});

// Add index for faster lookups
uniqueQuestionSchema.index({ normalizedText: 1, subject: 1 });
uniqueQuestionSchema.index({ subject: 1, bloomsLevel: 1 });
uniqueQuestionSchema.index({ occurrenceCount: -1 });

export const getUniqueQuestionModel = (): Model<UniqueQuestion> => {
  return models["UniqueQuestion"] || model("UniqueQuestion", uniqueQuestionSchema);
};
