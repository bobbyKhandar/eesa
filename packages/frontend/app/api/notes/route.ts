import { NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"
import { SharedNoteRepository } from "@/backend/src/database/repositories/SharedNoteRepository"
import { UserRepository } from "@/backend/src/database/repositories/UserRepository"
import { MAX_NOTE_BYTES, sharedNoteMetadataSchema, validateNoteFile } from "@/backend/src/database/schemas/sharedNoteSchema"

const notes = new SharedNoteRepository()
export async function GET() {
  try {
    if (!(await auth()).userId) return NextResponse.json({ success: false, error: "Sign in to view notes." }, { status: 401 })
    return NextResponse.json({ success: true, notes: await notes.list() })
  } catch { return NextResponse.json({ success: false, error: "Could not load shared notes." }, { status: 500 }) }
}
export async function POST(request: Request) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ success: false, error: "Sign in to upload notes." }, { status: 401 })
    if (Number(request.headers.get("content-length")) > MAX_NOTE_BYTES + 64 * 1024) return NextResponse.json({ success: false, error: "Files must be 10 MB or smaller." }, { status: 413 })
    const form = await request.formData()
    const file = form.get("file")
    if (!(file instanceof File)) return NextResponse.json({ success: false, error: "Choose a file." }, { status: 400 })
    if (file.size > MAX_NOTE_BYTES) return NextResponse.json({ success: false, error: "Files must be 10 MB or smaller." }, { status: 413 })
    const bytes = new Uint8Array(await file.arrayBuffer())
    let contentType
    try { contentType = validateNoteFile(file.name, bytes) } catch (error) { return NextResponse.json({ success: false, error: (error as Error).message }, { status: 400 }) }
    const user = await new UserRepository().getById(userId)
    const metadata = sharedNoteMetadataSchema.safeParse({ title: form.get("title"), description: form.get("description") || "", subject: form.get("subject"), tags: String(form.get("tags") || "").split(",").map(tag => tag.trim()).filter(Boolean), ownerId: userId, uploadedBy: (user?.name || "Student").slice(0, 120), contentType })
    if (!metadata.success) return NextResponse.json({ success: false, error: "Check the title, subject, description and tags." }, { status: 400 })
    return NextResponse.json({ success: true, note: await notes.upload(file.name, bytes, metadata.data) }, { status: 201 })
  } catch { return NextResponse.json({ success: false, error: "Upload failed. Please try again." }, { status: 500 }) }
}
