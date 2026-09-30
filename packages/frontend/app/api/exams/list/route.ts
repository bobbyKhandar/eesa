import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { ExamRepository } from "@/backend/dist/database/repositories/ExamRepository";
import { UserRepository } from "@/backend/dist/database/repositories/UserRepository";

const examRepo = new ExamRepository();
const userRepo = new UserRepository();

export async function GET(req: Request) {
  try {
    const userId = (await auth()).userId;
    console.log("Authenticated user ID:", userId);
    
    if (!userId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Get user's allocated exam IDs using repository
    const allocatedExamIds = await userRepo.getAllocatedExams(userId);
    
    if (allocatedExamIds.length === 0) {
      return NextResponse.json(
        { 
          success: true, 
          exams: [] 
        },
        { status: 200 }
      );
    }

    // Get exams by IDs using repository (one query, request order preserved)
    const validExams = await examRepo.getByIds(allocatedExamIds);
    
    if (validExams.length === 0) {
      return NextResponse.json(
        { 
          success: true, 
          exams: [] 
        },
        { status: 200 }
      );
    }

    // Transform exams to include calculated fields
    const transformedExams = validExams.map((exam: any) => ({
      id: exam._id?.toString(),
      title: exam.examTitle,
      description: exam.examDescription,
      subject: exam.subject,
      degree: exam.examDegree,
      type: exam.examType,
      duration: exam.duration,
      questions: exam.questions?.length || 0,
      maxMarks: exam.examMaxMarks,
      passingPercentage: exam.passingPercentage,
      createdAt: exam.createdAt,
      createdBy: exam.createdBy,
      scheduledAt: exam.scheduledAt,
      assignedUsers: exam.assignedUsers?.length || 0,
      instructions: exam.instructions,
      negativeMarking: exam.negativeMarking,
      // All exams are active by default (scheduled/draft kept for future UI enhancement)
      status: 'active'
    }));

    return NextResponse.json(
      { 
        success: true, 
        exams: transformedExams 
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("Error fetching exams:", err);
    return NextResponse.json(
      { success: false, error: "Failed to fetch exams" },
      { status: 500 }
    );
  }
}
