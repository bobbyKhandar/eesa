import assert from "node:assert/strict"
import { Writable, Readable } from "node:stream"
import { test } from "node:test"
import mongoose from "mongoose"
import { SharedNoteRepository } from "../../packages/backend/src/database/repositories/SharedNoteRepository.ts"
import { MAX_NOTE_BYTES, sharedNoteMetadataSchema, validateNoteFile } from "../../packages/backend/src/database/schemas/sharedNoteSchema.ts"

test("note validation rejects missing fields, empty/oversized and disguised files", () => {
  assert.equal(validateNoteFile("notes.pdf", Buffer.from("%PDF-1.7\nNotes")), "application/pdf")
  assert.equal(validateNoteFile("notes.txt", Buffer.from("Study notes")), "text/plain")
  assert.throws(() => validateNoteFile("empty.txt", Buffer.alloc(0)), /non-empty/)
  assert.throws(() => validateNoteFile("huge.txt", Buffer.alloc(MAX_NOTE_BYTES + 1)), /10 MB/)
  assert.throws(() => validateNoteFile("fake.pdf", Buffer.from("<script>bad</script>")), /valid PDF/)
  assert.throws(() => validateNoteFile("binary.txt", Buffer.from([0xff, 0x00])), /UTF-8/)
  assert.equal(sharedNoteMetadataSchema.safeParse({ title: " ", subject: "" }).success, false)
})

test("shared-note repository round-trips bytes and metadata without exposing private owner identity", async () => {
  const files: any[] = []
  const bytes = new Map<string, Buffer>()
  const bucket: any = {
    openUploadStream(filename, options) {
      const id = new mongoose.mongo.ObjectId()
      const chunks: Buffer[] = []
      const stream = new Writable({ write(chunk, _encoding, done) { chunks.push(chunk); done() }, final(done) { const buffer = Buffer.concat(chunks); bytes.set(String(id), buffer); files.push({ _id: id, filename, metadata: options.metadata, length: buffer.length, uploadDate: new Date() }); done() } })
      Object.assign(stream, { id, abort: async () => {} })
      return stream
    },
    find(query) {
      const selected = query._id ? files.filter(file => String(file._id) === String(query._id)) : files
      return { sort() { return this }, limit() { return this }, async next() { return selected[0] }, async toArray() { return selected } }
    },
    openDownloadStream(id) { return Readable.from([bytes.get(String(id))]) },
  }
  const repo = new SharedNoteRepository(async () => bucket)
  const input = Buffer.from("Study notes with real content")
  const note = await repo.upload("../../notes.txt", input, { title: "My notes", description: "A study guide", subject: "Math", tags: ["revision"], ownerId: "private-clerk-id", uploadedBy: "Student" })
  assert.equal(note.title, "My notes")
  assert.equal("ownerId" in note, false)
  assert.equal(files[0].filename, "notes.txt")
  assert.equal(files[0].metadata.ownerId, "private-clerk-id")
  assert.equal((await repo.list()).length, 1)
  const download = await repo.download(note.id)
  assert.ok(download)
  assert.deepEqual(download.bytes, input)
  assert.equal(download.note.contentType, "text/plain")
  assert.equal(await repo.download("../invalid-id"), null)
  assert.equal(await repo.download("000000000000000000000000"), null)
})

test("failed storage writes do not return a false upload success", async () => {
  let aborted = false
  const repo = new SharedNoteRepository(async () => ({ openUploadStream() {
    return Object.assign(new Writable({ write(_chunk, _encoding, done) { done(new Error("Storage unavailable")) } }), { abort: async () => { aborted = true } })
  } }) as any)
  await assert.rejects(repo.upload("notes.txt", Buffer.from("Notes"), { title: "Notes", description: "", subject: "Math", tags: [], ownerId: "user", uploadedBy: "Student" }), /Storage unavailable/)
  assert.equal(aborted, true)
})
