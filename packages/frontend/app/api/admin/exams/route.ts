import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { examRepo, userRepo } from "@/backend/dist/database/repositories/index";
import { toAdminExamRow } from "@/frontend/lib/adminExamList";

/**
 * GET /api/admin/exams
 * Every exam, for the admin catalog. The student list route only returns
 * the caller's own allocation, which is why the admin page used to invent rows.
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

    const caller = await userRepo.getById(userId);
    if (caller?.role !== "admin") {
      return NextResponse.json(
        { success: false, error: "Forbidden" },
        { status: 403 },
      );
    }

    const exams = await examRepo.getAll(200);
    return NextResponse.json({
      success: true,
      exams: exams.map(toAdminExamRow).filter((row) => row !== null),
    });
  } catch (error) {
    console.error("Error listing exams for admin:", error);
    return NextResponse.json(
      { success: false, error: "Failed to load exams" },
      { status: 500 },
    );
  }
}
