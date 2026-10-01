import { NextResponse } from "next/server";
import { userRepo } from "@/backend/dist/database/repositories/index.js";
import { isAccountStatus, toAdminUserRow } from "@/frontend/lib/adminUserList";
import { resolveIsAdmin } from "@/frontend/lib/resolveAdmin";

async function forbid() {
  return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
}

export async function GET() {
  try {
    if (!(await resolveIsAdmin())) return forbid();

    const [users, counts] = await Promise.all([userRepo.getAll(500), userRepo.getCounts()]);
    return NextResponse.json({
      success: true,
      counts,
      users: users.map(toAdminUserRow).filter((row) => row !== null),
    });
  } catch (error) {
    console.error("Error listing users:", error);
    return NextResponse.json(
      { success: false, error: "Failed to load users" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    if (!(await resolveIsAdmin())) return forbid();

    const body = await request.json().catch(() => null);
    const userId = typeof body?.userId === "string" ? body.userId : "";
    const status = body?.status;
    if (!userId || !isAccountStatus(status)) {
      return NextResponse.json(
        { success: false, error: "userId and a valid status are required" },
        { status: 400 },
      );
    }

    const result = await userRepo.update(userId, { status });
    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error || "Failed to update status" },
        { status: 400 },
      );
    }

    return NextResponse.json({ success: true, userId, status });
  } catch (error) {
    console.error("Error updating user status:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update user" },
      { status: 500 },
    );
  }
}
