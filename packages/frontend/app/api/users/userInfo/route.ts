import { NextResponse } from "next/server";
import {userRepo } from "@/backend/dist/database/repositories/index.js"; // Import singleton instance

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { email } = body as { email?: string };
    if (!email) {
      return NextResponse.json(
        { success: false, error: "Missing email" },
        { status: 400 }
      );
    }
    const resp = await userRepo.getByEmail(email);
    return NextResponse.json({data:resp,success:true}, {status: 200 });
  } catch (err) {
    console.error("Proxy error (user info):", err);
    return NextResponse.json(
      { success: false, error: "Failed to reach backend server" },
      { status: 502 }
    );
  }
}
