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

    const x=await userRepo.getById(user.id);
    if(!x) {
        const userMeta={
            _id: user.id      ,
            email: user.emailAddresses?.[0]?.emailAddress||"",
            name: user.fullName||"",
            role: role,
            currentAllocatedExams: [],
            submissionHistory: [],
            createdAt: new Date(),
            lastLogin: new Date(),
        }
        userRepo.create(userMeta);
        console.log("New user created:", userMeta);
        return NextResponse.json({user:userMeta,success:true}, {status: 200 });
    }else{
        return NextResponse.json({user:x,success:true}, {status: 200 });
    }
  } catch (err) {
    console.error("Proxy error (user metadata):", err);
    return NextResponse.json(
      { success: false, error: "Failed to reach backend server" },
      { status: 502 }
    );
  }
}
