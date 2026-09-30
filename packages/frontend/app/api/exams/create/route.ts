// app/api/exams/create/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { examRepo, promptRepo, userRepo } from "@/backend/dist/database/repositories/index";
import { buildStoredQuestionOptions } from "@/backend/src/services/mcqAlignment";
import {
  computeNegativeMarks,
  findInvalidQuestion,
  findInvalidSettings,
  normalizeAssignedUsers,
  parseScheduledAt,
  resolveDuration,
  resolveNegativeMarkingPercentage,
} from "@/frontend/lib/examCreation";

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
      scheduledAt,
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
      typeof examDegree !== "string"
    ) {
      return NextResponse.json(
        { success: false, error: "Missing or invalid required fields" },
        { status: 400 }
      );
    }

    const questionError = findInvalidQuestion(questions);
    if (questionError) {
      return NextResponse.json(
        { success: false, error: questionError },
        { status: 400 }
      );
    }

    const settingsError = findInvalidSettings({ passingPercentage, duration, negativeMarking, negativeMarkingPercentage });
    if (settingsError) {
      return NextResponse.json(
        { success: false, error: settingsError },
        { status: 400 }
      );
    }

    const parsedScheduledAt = parseScheduledAt(scheduledAt);
    if (scheduledAt && !parsedScheduledAt) {
      return NextResponse.json(
        { success: false, error: "scheduledAt must be a valid date" },
        { status: 400 }
      );
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
    const examQuestionsData = questions.map((q: any, index: number) => {
      const stored = buildStoredQuestionOptions({
        options: Array.isArray(q.options) ? q.options : undefined,
        correctOption: typeof q.correctOption === "number" ? q.correctOption : undefined,
        answer: q.answer,
      });
      return {
        promptId: promptsResult.promptIds![index],
        marks: q.marks,
        negativeMarks: computeNegativeMarks(q.marks, negativeMarking === true, negativeMarkingPercentage),
        questionType: q.type?.toUpperCase() || 'TEXT',
        answer: stored.answer ?? '',
        options: stored.options,
      };
    });

    /* ------------- Step 3: Ensure user exists in database ------------- */
    // Ensure database connection
    const { connect } = await import("@/backend/dist/database/connect.js");
    await connect();
    
    // Get user from Clerk to create in our database if needed
    const { currentUser } = await import("@clerk/nextjs/server");
    const clerkUser = await currentUser();
    
    if (clerkUser) {
      const { userRepo } = await import("@/backend/dist/database/repositories/index.js");
      const { buildUserProfile } = await import("@/backend/src/services/userProvisioning");

      const email = clerkUser.emailAddresses[0]?.emailAddress || '';

      if (email) {
        // Single provisioning path: the same upsert the dashboard uses, so the
        // stored role no longer depends on which page loaded first and the
        // find-then-create pair cannot race with it.
        const existing = await userRepo.getById(userId);
        const profile = buildUserProfile(
          {
            userId,
            email,
            name: clerkUser.firstName
              ? `${clerkUser.firstName} ${clerkUser.lastName || ""}`.trim()
              : undefined,
            imageUrl: clerkUser.imageUrl,
          },
          { existingRole: existing?.role }
        );
        const provisioned = await userRepo.upsertByClerkId(profile);
        if (!provisioned.success) {
          return NextResponse.json(
            { success: false, error: provisioned.error || "Failed to provision user" },
            { status: 500 }
          );
        }
      }
    }

    // Automatically assign the exam to the creator
    const assignedUsersList = normalizeAssignedUsers(examUsers, userId);

    const examData = {
      examTitle,
      examDescription,
      subject,
      examDegree,
      examType,
      passingPercentage,
      duration: resolveDuration(duration),
      scheduledAt: parsedScheduledAt,
      createdBy: userId,
      instructions: instructions || undefined,
      negativeMarking: negativeMarking || false,
      negativeMarkingPercentage: negativeMarking ? resolveNegativeMarkingPercentage(negativeMarkingPercentage) : undefined,
      assignedUsers: assignedUsersList,
      questions: examQuestionsData
    };

    const examResult = await examRepo.createWithPrompts(examData);

    if (!examResult.success || !examResult.examId) {
      return NextResponse.json(
        { success: false, error: examResult.error || "Failed to create exam" },
        { status: 500 }
      );
    }

    const examId = examResult.examId;

    // The allocation inside `createWithPrompts` is best-effort and skips user
    // documents that do not exist yet, so repeat it for the creator (#16):
    // /api/exams/list only ever reads `currentAllocatedExams`.
    const allocation = await userRepo.assignExam(userId, examId);
    if (!allocation.success) {
      console.error(`Exam ${examId} created but the creator was not allocated:`, allocation.error);
    }

    return NextResponse.json(
      { 
        success: true, 
        message: "Exam created successfully!",
        examId,
        creatorAssigned: allocation.success
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