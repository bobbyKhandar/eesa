// app/api/exams/create/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { examRepo, promptRepo } from "@/backend/dist/database/repositories/index";

export async function POST(req: Request) {
  try {
    const userId = (await auth()).userId;
    console.log("Authenticated user ID:", userId);
    
    if (!userId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await req.json();

    const {
      examTitle,
      examDescription,
      subject,
      examType,
      passingPercentage,
      examDegree,
      duration,
      instructions,
      negativeMarking,
      negativeMarkingPercentage,
      examUsers,
      questions
    } = body;

    /* ------------- BASIC validation ------------- */
    if (
      typeof examTitle !== "string" ||
      typeof examDescription !== "string" ||
      typeof subject !== "string" ||
      typeof examType !== "string" ||
      typeof passingPercentage !== "number" ||
      typeof examDegree !== "string" ||
      !Array.isArray(questions) || 
      questions.length === 0
    ) {
      return NextResponse.json(
        { success: false, error: "Missing or invalid required fields" },
        { status: 400 }
      );
    }

    /* Validate every question has text and marks */
    for (const q of questions) {
      if (typeof q.text !== "string" || typeof q.marks !== "number" || q.marks <= 0) {
        return NextResponse.json(
          { success: false, error: "Invalid question format - all questions must have text and positive marks" },
          { status: 400 }
        );
      }
    }

    /* ------------- Step 1: Create Prompts (Central Question Library) ------------- */
    const promptsData = questions.map((q: any) => ({
      questionText: q.text,
      subject: subject,
      topic: q.topic || undefined,
      generateVia: 'user' as const,
      createdBy: userId,
      bloomsLevel: q.bloomsLevel || undefined
    }));

    const promptsResult = await promptRepo.createBulk(promptsData);
    
    if (!promptsResult.success || !promptsResult.promptIds) {
      return NextResponse.json(
        { success: false, error: promptsResult.error || "Failed to create question prompts" },
        { status: 500 }
      );
    }

    /* ------------- Step 2: Create Exam with ExamQuestions ------------- */
    const examQuestionsData = questions.map((q: any, index: number) => ({
      promptId: promptsResult.promptIds![index],
      marks: q.marks,
      negativeMarks: negativeMarking ? (q.marks * (negativeMarkingPercentage || 25) / 100) : 0,
      questionType: q.type?.toUpperCase() || 'TEXT',
      answer: q.answer || '',
      options: q.options ? q.options.map((opt: string, i: number) => ({
        text: opt,
        isCorrect: i === q.correctOption
      })) : undefined
    }));

    /* ------------- Step 3: Ensure user exists in database ------------- */
    // Ensure database connection
    const { connect } = await import("@/backend/dist/database/connect.js");
    await connect();
    
    // Get user from Clerk to create in our database if needed
    const { currentUser } = await import("@clerk/nextjs/server");
    const clerkUser = await currentUser();
    
    if (clerkUser) {
      const { getUserModel } = await import("@/backend/dist/database/mongooseSchemas.js");
      const UserModel = getUserModel();
      
      // Check if user exists
      let user = await UserModel.findById(userId);
      
      if (!user) {
        // Create user with Clerk ID as _id
        await UserModel.create({
          _id: userId,
          email: clerkUser.emailAddresses[0]?.emailAddress || '',
          name: clerkUser.firstName ? `${clerkUser.firstName} ${clerkUser.lastName || ''}`.trim() : undefined,
          role: 'teacher', // Default to teacher for exam creators
          currentAllocatedExams: [],
          submissionHistory: [],
          createdAt: new Date()
        });
      }
    }

    // Automatically assign the exam to the creator
    const assignedUsersList = Array.isArray(examUsers) ? [...examUsers] : [];
    if (!assignedUsersList.includes(userId)) {
      assignedUsersList.push(userId);
    }

    const examData = {
      examTitle,
      examDescription,
      subject,
      examDegree,
      examType,
      passingPercentage,
      duration: duration || 60,
      scheduledAt: undefined,
      createdBy: userId,
      instructions: instructions || undefined,
      negativeMarking: negativeMarking || false,
      negativeMarkingPercentage: negativeMarking ? (negativeMarkingPercentage || 25) : undefined,
      assignedUsers: assignedUsersList,
      questions: examQuestionsData
    };

    const examResult = await examRepo.createWithPrompts(examData);

    if (!examResult.success) {
      return NextResponse.json(
        { success: false, error: examResult.error || "Failed to create exam" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { 
        success: true, 
        message: "Exam created successfully!",
        examId: examResult.examId 
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("Error creating exam:", err);
    return NextResponse.json(
      { success: false, error: "Failed to create exam" },
      { status: 500 }
    );
  }
}