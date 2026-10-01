import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { userRepo } from "@/backend/dist/database/repositories/index.js";

type Denied = NextResponse | null;

/** Signed-in caller, or a 401 response. */
export async function requireSignedIn(): Promise<Denied> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );
  }
  return null;
}

/**
 * Question-paper upload forwards files to the AI pipeline. That is an admin
 * action. A missing account fails closed, the same way an unknown role does.
 */
export async function requireAdminCaller(): Promise<Denied> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const record = await userRepo.getById(userId);
  if (record?.role !== "admin") {
    return NextResponse.json(
      { success: false, error: "Forbidden" },
      { status: 403 },
    );
  }
  return null;
}
