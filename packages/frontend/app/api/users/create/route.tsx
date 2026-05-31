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

    const existing = await userRepo.getById(user.id);
    if (existing) {
        return NextResponse.json({user: existing, success: true}, {status: 200});
    }

    const userMeta = {
        _id: user.id,
        email: user.emailAddresses?.[0]?.emailAddress || "",
        name: user.fullName || "",
        role: role,
        currentAllocatedExams: [],
        submissionHistory: [],
        createdAt: new Date(),
        lastLogin: new Date(),
    };

    const result = await userRepo.create(userMeta);
    if (result.success) {
        console.log("New user created:", userMeta);
        return NextResponse.json({user: userMeta, success: true}, {status: 200});
    }

    // Race condition: another request inserted between our getById and create
    const retry = await userRepo.getById(user.id);
    if (retry) {
        return NextResponse.json({user: retry, success: true}, {status: 200});
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
