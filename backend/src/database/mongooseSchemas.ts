
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
import {examZodSchema,Exam} from "./schemas/examSchemaZod.js"
import {questionsZodSchema,Question} from "./schemas/questionSchemaZod.js"
import {subjectZodSchema,Subject} from "./schemas/subjectSchemaZod.js"
import {userZodSchema,User} from "./schemas/userSchemaZod.js"


//schema conversion(zod->mongoose) -----------------------------------------------------------------------------------------------
const examSchema = zodSchema(examZodSchema);
const questionSchema =zodSchema(questionsZodSchema)
const subjectSchema =zodSchema(subjectZodSchema)
const userSchema =zodSchema(userZodSchema)



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
  
  return models["subjects"] || model("subjects", subjectSchema);
}

/**
 * lazily initializes user model
 * @returns mongoose model named user 
*/
export  function getUserModel(): Model<User> {
   return models["user"] || model("user", userSchema);
}