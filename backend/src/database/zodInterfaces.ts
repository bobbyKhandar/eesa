/*
todo:-
1. Add more validation to the schemas
2. Describe the schemas in comments
3. Convert the Zod schemas to Mongoose schemas using mongoose-zod
4. Compartmentalize the schemas into separate files
*/

import { z } from "zod";
import mongoose from "mongoose";
import path from "path"
import dotenv from "dotenv"


dotenv.config({path: path.resolve(__dirname,"../../.env")  });


export async function connect() {
    const MONGO_URI = process.env.mongodb_url;
  if (!MONGO_URI) {
    throw new Error("❌ MongoDB URI is missing. Check your .env file.");
  }

  if (mongoose.connection.readyState === 0) {
    try {
      await mongoose.connect(MONGO_URI, { useNewUrlParser: true });
      console.log("✅ DB connected successfully");
    } catch (error) {
      console.error("❌ Error while connecting to MongoDB:", error);
    }
  }
}

// Exam Schema
export const examZodSchema = z.object({
  examid: z.number(),
  examName: z.string(),
  examType: z.string(), // mcq/theory
  examFollowup: z.string(), // main or kt or golden kt
  examMaxMarks: z.number(),
  examPassingPercentage: z.number(),
  examDegree: z.string(), // degree at which exam is pursuing
  examUsers: z.array(z.string()), // Foreign Key
  examquestions: z.array(
    z.object({
      questionId: z.string(), // ObjectId as string
      marks: z.number(),
    })
  ),
  studentsResponse: z.array(
    z.object({
      question: z.string(),
      marks: z.number(),
      allottedMarks: z.number(),
      feedback: z.string(),
    })
  ),
});

// Exam Questions Schema
export const examQuestionsZodSchema = z.object({
  // The question itself, required field
  questionText: z.string(),

  /*
    The correct answer to the question 
    for mcq questions, this will be the option that is correct
    for theory questions, this will be the answer to the question which will be compared with the student's answer using LLM, comparing the meaning behind both answers 
    optional field, if the question is not MCQ then the value is "NOT PRESENT"
  */
  questionAnswer: z.string().default("NOT PRESENT"),

  // Array of options for MCQ if the question is NOT MCQ then the array is empty
  questionOptions: z.array(z.string()).default([]),

  // mcq or theory
  questionType: z.enum(["mcq", "theory"]),

  // Bloom's taxonomy level only accepted values are remember, understand, apply, analyze, evaluate, create
  questionBloomsTaxonomy: z.enum([
    "remember",
    "understand",
    "apply",
    "analyze",
    "evaluate",
    "create",
  ]),
});

// Subject Schema
export const subjectZodSchema = z.object({
  subjectName: z.string(),
  subjectDescription: z.string(),
  subjectDegree: z.string(),
  subjectMarks: z.string(),
  subjectUsers: z.array(z.string()),
  subjectOngoingExams: z.array(z.string()).default([]),
  subjectReview: z
    .array(
      z.object({
        studentRating: z.number(),
        studentFeedback: z.string(),
      })
    )
    .default([]),
  numberOfReviews: z.number().default(0),
  totalRating: z.number().default(0),
  subjectPyq: z.array(z.any()).default([]),
  subjectSyllabus: z.string().default(""),
});

// User History Schema
export const userHistoryZodSchema = z.object({
  examId: z.string(),
  total: z.number().default(0),
  allocated: z.number().default(0),
  score: z.number().default(0),
});

// User Schema
export const userZodSchema = z.object({
  useremail: z.string(),
  userRole: z.string().default("user"),
  totalAllocatedExams: z.string().default("0"),
  totalCompletedExams: z.string().default("0"),
  userHistory: z.array(userHistoryZodSchema).default([]),
});


