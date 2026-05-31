import mongoose from "mongoose";
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

export const getSubjectModel = () => {
  return models["Subject"] || model("Subject", subjectSchema);
};

// Syllabus Schema
const syllabusSchema = zodSchema(syllabusDocumentZodSchema, syllabusSchemaOptions);

export const getSyllabusModel = () => {
  return models["Syllabus"] || model("Syllabus", syllabusSchema);
};

// Past Paper Schema
const pastPaperSchema = zodSchema(pastPaperDocumentZodSchema, pastPaperSchemaOptions);

export const getPastPaperModel = () => {
  return models["PastPaper"] || model("PastPaper", pastPaperSchema);
};

// Exam Analysis Schema
const examAnalysisSchema = zodSchema(examAnalysisDocumentZodSchema, examAnalysisSchemaOptions);

export const getExamAnalysisModel = () => {
  return models["ExamAnalysis"] || model("ExamAnalysis", examAnalysisSchema);
};

// Analysis Report Schema (Published Question Banks)
const analysisReportSchema = zodSchema(analysisReportZodSchema, analysisReportSchemaOptions);

export const getAnalysisReportModel = () => {
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

export const getUniqueQuestionModel = () => {
  return models["UniqueQuestion"] || model("UniqueQuestion", uniqueQuestionSchema);
};
