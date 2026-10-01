import { NextResponse } from "next/server";
import { submissionRepo,userRepo } from "@/backend/dist/database/repositories/index.js"; // Import singleton instance
import { submissionAccessDecision } from "@/backend/src/services/examAccess";
import { deny, getCaller } from "@/frontend/lib/requestAuth";

export async function POST(req: Request) {
  try {
    const caller = await getCaller();
    if (!caller.userId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { email } = body as { email?: string };
    if (!email) {
      return NextResponse.json(
        { success: false, error: "Missing email" },
        { status: 400 }
      );
    }

    // Use submissionRepo instance to call getByUser method
    console.log(email)
    const x=await userRepo.getByEmail(email);
    if (!x?._id) {
      return NextResponse.json(
        { success: false, error: "User not found" },
        { status: 404 }
      );
    }
    const targetUserId = x._id.toString();
    const denied = deny(submissionAccessDecision({
      callerId: caller.userId,
      callerRole: caller.role,
      submissionUserId: targetUserId,
    }));
    if (denied) return denied;

    console.log(targetUserId)
    const resp = await submissionRepo.getByUser(targetUserId);
    console.log("User submissions fetched:", resp);
    return NextResponse.json({submissions:resp,success:true}, {status: 200 });
  } catch (err) {
    console.error("Proxy error (user submissions):", err);
    return NextResponse.json(
      { success: false, error: "Failed to reach backend server" },
      { status: 502 }
    );
  }
}
