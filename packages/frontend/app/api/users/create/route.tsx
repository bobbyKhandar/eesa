import { NextResponse } from "next/server";
import { userRepo } from "@/backend/dist/database/repositories/index.js";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { user, role } = body;
    if (!user.id) {
      return NextResponse.json(
        { success: false, error: "Missing user.id" },
        { status: 400 }
      );
    }

    const userMeta = {
        _id: user.id,
        email: user.emailAddresses?.[0]?.emailAddress || "",
        name: user.fullName || "",
        role: role,
        profilePic: user.imageUrl || "",
        status: "active",
        branch: "",
        currentAllocatedExams: [],
        submissionHistory: [],
        createdAt: new Date(),
        lastLogin: new Date(),
        settings: {
            notifications: { examReminders: true, gradeUpdates: true, resourceUpdates: false, systemUpdates: true, emailNotifications: true, pushNotifications: false, weeklyDigest: true },
            preferences: { theme: "system", language: "en", timezone: "UTC-5", dateFormat: "MM/DD/YYYY", defaultView: "dashboard" },
            privacy: { dataUsageAnalytics: true, marketingCommunications: false, loginAlerts: true },
        },
    };

    const result = await userRepo.upsertByClerkId(userMeta);
    if (result.success && result.user) {
        return NextResponse.json({user: result.user, success: true}, {status: 200});
    }

    return NextResponse.json(
        {success: false, error: result.error || "Failed to create user"},
        {status: 500}
    );
  } catch (err) {
    console.error("Proxy error (user metadata):", err);
    return NextResponse.json(
      { success: false, error: "Failed to reach backend server" },
      { status: 502 }
    );
  }
}
