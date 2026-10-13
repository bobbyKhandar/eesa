import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { userRepo } from "@/backend/dist/database/repositories/index.js";
import { listAssignableStudents } from "@/frontend/lib/examCreation";

/**
 * GET /api/users/students
 * Active students a signed-in user can assign a teacher exam to.
 * The caller is omitted because exam creation already assigns the creator.
 */
export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    const students = await userRepo.getStudents(1000);
    return NextResponse.json({
      success: true,
      students: listAssignableStudents(students, userId),
    });
  } catch (error) {
    console.error("Error listing assignable students:", error);
    return NextResponse.json(
      { success: false, error: "Failed to load students" },
      { status: 500 },
    );
  }
}
