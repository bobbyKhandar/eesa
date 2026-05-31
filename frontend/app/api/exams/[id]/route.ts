import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
// STEP 2: Import repository directly (not through index)
import { ExamRepository } from "@/backend/dist/database/repositories/ExamRepository";

const examRepo = new ExamRepository();

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    console.log("STEP 2: API Route called - testing direct repository import");
    
    const userId = (await auth()).userId;
    console.log("STEP 2: User authenticated:", userId);
    
    if (!userId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { id: examId } = await context.params;
    console.log("STEP 2: Exam ID from params:", examId);
    
    // STEP 2: Try to fetch from database using direct repository import
    try {
      console.log("STEP 2: Attempting to fetch exam from database...");
      const exam = await examRepo.getWithFullDetails(examId);
      
      if (!exam) {
        console.log("STEP 2: Exam not found, trying basic lookup...");
        const basicExam = await examRepo.getById(examId);
        console.log("STEP 2: Basic exam lookup result:", basicExam ? "Found" : "Not found");
        
        return NextResponse.json(
          { success: false, error: "Exam not found" },
          { status: 404 }
        );
      }

      console.log("STEP 2: Found exam:", exam.examTitle);
      console.log("STEP 2: Question details:", exam.questionDetails?.length || 0, "questions");

      // Check if user is assigned
      if (!exam.assignedUsers?.includes(userId)) {
        return NextResponse.json(
          { success: false, error: "You are not assigned to this exam" },
          { status: 403 }
        );
      }

      // Transform questionDetails
      const transformedExam = {
        ...exam,
        questions: exam.questionDetails?.map((q: any) => ({
          _id: q._id?.toString(),
          questionText: q.promptData?.questionText || '',
          questionType: q.questionType,
          marks: q.marks,
          negativeMarks: q.negativeMarks,
          options: q.options,
          answer: q.answer
        })) || []
      };

      console.log("STEP 2: Successfully transformed exam data");
      return NextResponse.json(
        { success: true, exam: transformedExam },
        { status: 200 }
      );
      
    } catch (dbError) {
      console.error("STEP 2: Database error:", dbError);
      throw dbError;
    }

    /* STEP 2: Static data fallback commented out
    const staticExam = {
      _id: examId,
      examTitle: "Operating Systems Final Exam",
      examDescription: "Comprehensive exam covering all OS topics",
      subject: "Operating Systems",
      duration: 60,
      examMaxMarks: 50,
      instructions: "Answer all questions. Show your work for full credit.",
      negativeMarking: true,
      assignedUsers: [userId], // Include current user
      questions: [
        {
          _id: "q1",
          questionText: "Explain the difference between process and thread.",
          questionType: "TEXT",
          marks: 10
        },
        {
          _id: "q2",
          questionText: "What is a deadlock?",
          questionType: "TEXT",
          marks: 10
        }
      ]
    };
    console.log("STEP 1: Returning static exam data");
    return NextResponse.json(
      { success: true, exam: staticExam },
      { status: 200 }
    );
    const { id: examId } = await context.params;
    console.log("Fetching exam with ID:", examId);

    */
  } catch (err) {
    console.error("Error fetching exam:", err);
    return NextResponse.json(
      { success: false, error: "Failed to fetch exam" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const userId = (await auth()).userId;
    
    if (!userId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { id: examId } = await context.params;

    // Get exam to check ownership
    const exam = await examRepo.getById(examId);

    if (!exam) {
      return NextResponse.json(
        { success: false, error: "Exam not found" },
        { status: 404 }
      );
    }

    // Check if user is the creator
    if (exam.createdBy !== userId) {
      return NextResponse.json(
        { success: false, error: "Only the exam creator can delete this exam" },
        { status: 403 }
      );
    }

    // Delete the exam
    const result = await examRepo.delete(examId);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error || "Failed to delete exam" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { 
        success: true, 
        message: "Exam deleted successfully" 
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("Error deleting exam:", err);
    return NextResponse.json(
      { success: false, error: "Failed to delete exam" },
      { status: 500 }
    );
  }
}