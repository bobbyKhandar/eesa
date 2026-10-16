
/*
*Database Models
*The schemas are converted from zod type to mongoose compatiable type using @zodyac/zod-mongoose
*Each model is lazily initialized to reduce api calls and lessen up the response time for the database related client requests  

*/


//npm packages---------------------------------------------------------------------------------------
import { zodSchema } from "@zodyac/zod-mongoose";
import mongoose from "mongoose";
const {  model,models }=mongoose;
import type { Model } from "mongoose";


//schemas and types------------------------------------------------------------------------------------------
import type { Exam } from "./schemas/examSchemaZod.js";
import {examZodSchema} from "./schemas/examSchemaZod.js"
import {questionsZodSchema, type Question} from "./schemas/questionSchemaZod.js"
import {subjectZodSchema, type Subject} from "./schemas/subjectSchemaZod.js"
import {userZodSchema, type User} from "./schemas/userSchemaZod.js"
import {examSubmissionDocumentZodSchema, type ExamSubmissionDocument,examSubmissionSchemaOptions} from "./schemas/examSubmissionZod.js"
import {promptZodSchema, type Prompt} from "./schemas/promptSchemaZod.js"
import {examQuestionZodSchema, type ExamQuestion} from "./schemas/examQuestionSchemaZod.js"
import {jobMetadataZodSchema, type JobMetadata} from "./schemas/jobMetadataZod.js"
import {uploadSessionZodSchema, type UploadSession} from "./schemas/uploadSessionZod.js"
import { LEGACY_SUBJECT_COLLECTION } from "./subjectCollections.js";


//schema conversion(zod->mongoose) -----------------------------------------------------------------------------------------------
const examSchema = zodSchema(examZodSchema);
const questionSchema =zodSchema(questionsZodSchema)
const subjectSchema = zodSchema(subjectZodSchema, {
  collection: LEGACY_SUBJECT_COLLECTION,
});
const userSchema =zodSchema(userZodSchema)
const examSubmissionSchema = zodSchema(examSubmissionDocumentZodSchema, examSubmissionSchemaOptions)
const promptSchema = zodSchema(promptZodSchema)
const examQuestionSchema = zodSchema(examQuestionZodSchema)
const jobMetadataSchema = zodSchema(jobMetadataZodSchema)
const uploadSessionSchema = zodSchema(uploadSessionZodSchema)



//lazily initialized models--------------------------------------------------------------------------------------------------
/**returns an singleton QuestionModel  */
export function getQuestionModel():Model<Question> {
  return models["questions"] || model("questions", questionSchema);
}
/**returns an singleton ExamModel */
export  function getExamModel():Model<Exam> {
  return models["examSets"] || model("examSets", examSchema);
}
/**return an singleton SubjectModel */
export  function getSubjectModel():Model<Subject> {
  
  return models["subjects"] || model("subjects", subjectSchema, LEGACY_SUBJECT_COLLECTION);
}

/**
 * lazily initializes user model
 * @returns mongoose model named user 
*/
export  function getUserModel(): Model<User> {
   return models["user"] || model("user", userSchema);
}

/**
 * lazily initializes exam submission model
 * @returns mongoose model for exam submissions
 */
export function getExamSubmissionModel(): Model<ExamSubmissionDocument> {
  return models["ExamSubmission"] || model("ExamSubmission", examSubmissionSchema);
}

/**
 * lazily initializes prompt model (central question library)
 * @returns mongoose model for prompts
 */
export function getPromptModel(): Model<Prompt> {
  return models["Prompt"] || model("Prompt", promptSchema);
}

/**
 * lazily initializes exam question model (exam-specific question instances)
 * @returns mongoose model for exam questions
 */
export function getExamQuestionModel(): Model<ExamQuestion> {
  return models["ExamQuestion"] || model("ExamQuestion", examQuestionSchema);
}

/**
 * lazily initializes job metadata model (pipeline job tracking)
 * @returns mongoose model for job metadata
 */
export function getJobMetadataModel(): Model<JobMetadata> {
  return models["JobMetadata"] || model("JobMetadata", jobMetadataSchema);
}

/**
 * lazily initializes upload session model (user upload session tracking)
 * @returns mongoose model for upload sessions
 */
export function getUploadSessionModel(): Model<UploadSession> {
  return models["UploadSession"] || model("UploadSession", uploadSessionSchema);
}