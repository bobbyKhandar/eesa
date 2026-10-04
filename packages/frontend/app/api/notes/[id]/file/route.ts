import { NextRequest, NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"
import { SharedNoteRepository } from "@/backend/src/database/repositories/SharedNoteRepository"

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    if (!(await auth()).userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const file = await new SharedNoteRepository().download((await context.params).id)
    if (!file) return NextResponse.json({ error: "Note not found" }, { status: 404 })
    const disposition = request.nextUrl.searchParams.get("preview") === "1" ? "inline" : "attachment"
    return new Response(new Uint8Array(file.bytes), { headers: { "Content-Type": file.note.contentType, "Content-Disposition": `${disposition}; filename="${file.filename}"`, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox", "Cache-Control": "private, no-store" } })
  } catch { return NextResponse.json({ error: "Could not download the note." }, { status: 500 }) }
}
