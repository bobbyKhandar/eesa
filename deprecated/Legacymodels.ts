/* 
to do:
expand the question schema to include more fields like question options, correct answer, etc. and also add a field for question image , add dificulty level, and semantics search (using faiss)?  
*/
import mongoose from "mongoose";
import z from "zod";
import path from "path"
import dotenv from "dotenv"
dotenv.config({path: path.resolve(__dirname,"../../.env")  });

console.log(process.env.mongodb_url);

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

const examSchema = z.object({
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
})

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
  examquestions: [{
    questionId: { type: mongoose.Schema.Types.ObjectId, ref: "examQuestions" },
    marks: Number,
  }], // Array of question objects
  studentsResponse: [
    {
      question: String,
      marks: Number,
      allottedMarks: Number,
      feedback: String,
    },
  ],
});

const examQuestionsSchema = new mongoose.Schema({ 
     
  
  questionText: {type:String,required:true},// The question itself, required field 

  /*The correct answer to the question 
  for mcq questions, this will be the option that is correct
  for theory questions, this will be the answer to the question which will be compared with the student's answer using LLM, comparing the meaning behind both answers 
  optional field, if the question is not MCQ then the value is "NOT PRESENT"
  */
  questionAnswer: {type:String,default:"NOT PRESENT"}, 
      
  questionOptions: {type:[String],default:[]}, // Array of options for MCQ if the question is NOT MCQ then the array is empty
    
  questionType: {type:String,required:true,lowercase:true,enum:["mcq","theory"]}, // mcq or theory
      
  // Bloom's taxonomy level only accepted values are remember, understand, apply, analyze, evaluate, create
  questionBloomsTaxonomy: {
    type:String,
    enum: ["remember", "understand", "apply", "analyze", "evaluate", "create"],
    required: true,
    }
})

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
  //will add subjectImage later
  // subjectImage: {
  //   data: buffer,
  //   contentType: String,
  // },
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
    mongoose.models["subjects"] || mongoose.model("subjects", subjectSchema);
  return subjectModel;
}
async function getQuestionsModel() {
  const questionModel =
    mongoose.models["questions"] || mongoose.model("questions", examQuestionsSchema);
  return questionModel;
}
export { connect, getsubjectModel, getQuestionModel, getuserModel,getQuestionsModel};
