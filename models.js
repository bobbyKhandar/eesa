"use server"
import mongoose from "mongoose";
import dotenv from "dotenv";

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
  studentsResponse:[{question:String,marks:Number,allottedMarks:Number,feedback:String}],
});

const userSchema=new mongoose.Schema({
  useremail:String,
  userRole:{
    type:String,
    default:"user"
  },    
})

const QuestionModel = mongoose.models["examSets"] || mongoose.model("examSets", examSchema);
const userModel= mongoose.models["user"]||mongoose.model("user",userSchema);

export { connect, QuestionModel,userModel};
