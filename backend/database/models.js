"use server";
import mongoose, { mongo, Mongoose } from "mongoose";
import dotenv from "dotenv";
import { type } from "os";
import { buffer } from "stream/consumers";

dotenv.config();

const MONGO_URI = process.env.mongodb_url;

async function connect() {
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

// Debug existing models
console.log("Existing Mongoose models:", mongoose.modelNames());

// Define schema once
const examSchema = new mongoose.Schema({
  examid: Number,
  examName: String,
  examType: String, // mcq/theory
  examfollowup: String, // main or kt or golden kt
  examMaxMarks: Number,
  examPassingPercentage: Number,
  examDegree: String, // degree at which exam is pursuing
  examUsers: [{ type: String }], // Foreign Key
  examquestions: [{ type: String }],
  studentsResponse: [
    {
      question: String,
      marks: Number,
      allottedMarks: Number,
      feedback: String,
    },
  ],
});

const subjectSchema = new mongoose.Schema({
  subjectName: String,
  subjectDescription: String,
  subjectDegree: String,
  subjectMarks: String,
  subjectUsers: [{ type: String }],
  subjectOngoingExams: [{ type: String, default: "" }],
  subjectReview: {
    type: [
      {
        studentRating: Number,
        studentFeedback: String,
      },
    ],
    default: [],
  },
  numberOfReviews: { type: Number, default: 0 },
  totalRating: { type: Number, default: 0 },
  subjectPyq: [{ type: Object, default: [] }],
  subjectSyllabus: { type: String, default: "" },
  subjectImage: {
    data: buffer,
    contentType: String,
  },
});
const userHistorySchema = new mongoose.Schema(
  {
    examId: { type: String, required: true },
    total: { type: Number, default: 0 },
    allocated: { type: Number, default: 0 },
    score: { type: Number, default: 0 },
  },
  { _id: false }
);
const userSchema = new mongoose.Schema({
  useremail: String,
  userRole: {
    type: String,
    default: "user",
  },
  totalAllocatedExams: {
    type: String,
    default: 0,
  },
  totalCompletedExams: {
    type: String,
    default: 0,
  },
  userHistory: {
    type: [userHistorySchema],
    default: [],
  },
});

async function getuserModel() {
  const userModel =
    mongoose.models["user"] || mongoose.model("user", userSchema);
  return userModel;
}
async function getQuestionModel() {
  const QuestionModel =
    mongoose.models["examSets"] || mongoose.model("examSets", examSchema);
  return QuestionModel;
}
async function getsubjectModel() {
  const subjectModel =
    mongoose.models["Subject"] || mongoose.model("subjects", subjectSchema);
  return subjectModel;
}

export { connect, getsubjectModel, getQuestionModel, getuserModel };
