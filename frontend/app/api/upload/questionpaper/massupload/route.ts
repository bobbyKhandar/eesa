import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const BACKEND_URL =
  process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:5000";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const files = formData.getAll("files");

    const fileNames = files.map((file: File) => file.name);
    console.log("Received files:", fileNames);
    // TODO: Save files or process as needed
    return NextResponse.json({ success: true, files: fileNames });
  } catch (err) {
    console.error("Proxy error (create exam):", err);
    return NextResponse.json(
      { success: false, error: "Failed to reach backend server" },
      { status: 502 }
    );
  }
}