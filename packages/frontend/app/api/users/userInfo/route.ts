import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { userRepo } from "@/backend/dist/database/repositories/index.js"; // Import singleton instance

/**
 * Resolve the caller from the Clerk session. Identity never comes from the
 * request body: this route previously read an `email` out of the JSON payload
 * and returned the matching document to anyone, which let a visitor read any
 * account and enumerate which emails are registered.
 */
async function getCaller(): Promise<{ userId: string; record: Awaited<ReturnType<typeof userRepo.getById>> } | null> {
  const { userId } = await auth();
  if (!userId) return null;
  return { userId, record: await userRepo.getById(userId) };
}

/**
 * Public projection. The stored document also carries `__v` and any fields
 * added outside the schema; only what the dashboard needs is returned.
 */
function toPublicUser(record: NonNullable<Awaited<ReturnType<typeof userRepo.getById>>>) {
  return {
    id: String(record._id),
    email: record.email,
    name: record.name,
    role: record.role,
    currentAllocatedExams: Array.isArray(record.currentAllocatedExams) ? record.currentAllocatedExams : [],
    submissionHistory: Array.isArray(record.submissionHistory) ? record.submissionHistory : [],
    createdAt: record.createdAt,
    lastLogin: record.lastLogin,
  };
}

/**
 * Read the signed-in user's own record.
 *
 * - 401 when there is no session
 * - 404 when the account has not been provisioned yet. The dashboard treats
 *   this as its signal to call `POST /api/users/create`.
 */
export async function GET() {
  try {
    const caller = await getCaller();

    if (!caller) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    if (!caller.record) {
      return NextResponse.json(
        { success: false, error: "User not provisioned" },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { data: toPublicUser(caller.record), success: true },
      { status: 200 }
    );
  } catch (err) {
    console.error("Proxy error (user info):", err);
    return NextResponse.json(
      { success: false, error: "Failed to reach backend server" },
      { status: 502 }
    );
  }
}

/**
 * Body-driven variant kept for existing callers, but the email is honoured only
 * when it resolves to the caller's own record or the caller is an admin.
 */
export async function POST(req: Request) {
  try {
    const caller = await getCaller();

    if (!caller) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    let email: string | undefined;
    try {
      const body = (await req.json()) as { email?: string };
      email = body?.email;
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    let record = caller.record;

    if (email && record && record.email !== email) {
      if (record.role !== "admin") {
        return NextResponse.json(
          { success: false, error: "Forbidden" },
          { status: 403 }
        );
      }
      record = await userRepo.getByEmail(email);
      if (!record) {
        return NextResponse.json(
          { success: false, error: "User not found" },
          { status: 404 }
        );
      }
    }

    if (!record) {
      return NextResponse.json(
        { success: false, error: "User not provisioned" },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { data: toPublicUser(record), success: true },
      { status: 200 }
    );
  } catch (err) {
    console.error("Proxy error (user info):", err);
    return NextResponse.json(
      { success: false, error: "Failed to reach backend server" },
      { status: 502 }
    );
  }
}