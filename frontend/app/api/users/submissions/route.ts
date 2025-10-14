import { NextResponse } from "next/server";
import { submissionRepo,userRepo } from "@/backend/dist/database/repositories/index.js"; // Import singleton instance

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

    // Use submissionRepo instance to call getByUser method
    console.log(email)
    const x=await userRepo.getByEmail(email);
    console.log(x?._id.toString())
    const resp = await submissionRepo.getByUser(x?._id.toString());
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
