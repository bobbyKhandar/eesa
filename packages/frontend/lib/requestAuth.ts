import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { UserRepository } from "@/backend/src/database/repositories/UserRepository";
import {
  adminAccessDecision,
  examContentAccessDecision,
  submissionAccessDecision,
  type AccessDecision,
} from "@/backend/src/services/examAccess";

const userRepo = new UserRepository();

export async function getCaller(): Promise<{ userId: string | null; role: string | null }> {
  const { userId } = await auth();
  if (!userId) return { userId: null, role: null };
  const user = await userRepo.getById(userId);
  return { userId, role: user?.role ?? null };
}

export function deny(decision: AccessDecision): NextResponse | null {
  if (decision.allowed) return null;
  return NextResponse.json(
    { success: false, error: decision.error || "Forbidden" },
    { status: decision.status }
  );
}

export async function requireAdmin(): Promise<NextResponse | null> {
  const caller = await getCaller();
  return deny(adminAccessDecision({ callerId: caller.userId, callerRole: caller.role }));
}

export async function requireSubmissionAccess(submissionUserId: string | null | undefined): Promise<NextResponse | null> {
  const caller = await getCaller();
  return deny(
    submissionAccessDecision({
      callerId: caller.userId,
      callerRole: caller.role,
      submissionUserId: submissionUserId ?? null,
    })
  );
}

export async function requireExamContentAccess(exam: {
  assignedUsers?: string[] | null;
  createdBy?: string | null;
}) {
  const caller = await getCaller();
  const decision = examContentAccessDecision({
    callerId: caller.userId,
    callerRole: caller.role,
    assignedUsers: exam.assignedUsers,
    createdBy: exam.createdBy,
  });
  return { caller, decision, denied: deny(decision) };
}
