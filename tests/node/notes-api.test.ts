import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { Module } from "node:module"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import ts from "typescript"
import * as schema from "../../packages/backend/src/database/schemas/sharedNoteSchema.ts"

test("note APIs enforce sessions, validate files, bind ownership to the session and serve safe download headers", async () => {
  let userId: string | null = null
  let uploaded: any = null
  const note = { id: "123456789012345678901234", title: "Real note", contentType: "text/plain" }
  class Repository {
    async list() { return [note] }
    async upload(filename, bytes, metadata) { uploaded = { filename, bytes, metadata }; return note }
    async download(id) { return id === note.id ? { note, filename: "notes.txt", bytes: Buffer.from("Actual note content") } : null }
  }
  function route(relative: string) {
    const filename = fileURLToPath(new URL(relative, import.meta.url))
    const mod = new Module(filename)
    mod.require = id => {
      if (id === "next/server") return { NextResponse: { json: (data, init = {}) => new Response(JSON.stringify(data), { ...init, headers: { "content-type": "application/json" } }) } }
      if (id === "@clerk/nextjs/server") return { auth: async () => ({ userId }) }
      if (id.endsWith("/SharedNoteRepository")) return { SharedNoteRepository: Repository }
      if (id.endsWith("/UserRepository")) return { UserRepository: class { async getById(id) { assert.equal(id, userId); return { name: "Authenticated Student" } } } }
      if (id.endsWith("/sharedNoteSchema")) return schema
      throw new Error(`Unexpected route dependency: ${id}`)
    }
    mod._compile(ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename)
    return mod.exports
  }
  const notes = route("../../packages/frontend/app/api/notes/route.ts")
  const download = route("../../packages/frontend/app/api/notes/[id]/file/route.ts")
  const request = (filename = "notes.txt", content = "Actual note content", title = "Real note") => {
    const form = new FormData()
    form.set("file", new File([content], filename))
    form.set("title", title); form.set("subject", "Math"); form.set("ownerId", "spoofed-user")
    return new Request("http://localhost/api/notes", { method: "POST", body: form })
  }
  assert.equal((await notes.GET()).status, 401)
  assert.equal((await notes.POST(request())).status, 401)
  assert.equal(uploaded, null)
  userId = "trusted-session-user"
  assert.equal((await notes.POST(request("bad.pdf", "Not PDF"))).status, 400)
  assert.equal((await notes.POST(request("notes.txt", "Text", " "))).status, 400)
  assert.equal(uploaded, null)
  assert.equal((await notes.POST(new Request("http://localhost/api/notes", { method: "POST", headers: { "content-length": String(schema.MAX_NOTE_BYTES + 100000) } }))).status, 413)
  assert.equal((await notes.POST(request())).status, 201)
  assert.equal(uploaded.metadata.ownerId, "trusted-session-user")
  assert.equal(uploaded.metadata.uploadedBy, "Authenticated Student")
  assert.equal((await notes.GET()).status, 200)
  const response = await download.GET({ nextUrl: new URL("http://localhost/api/notes/file") }, { params: Promise.resolve({ id: note.id }) })
  assert.equal(response.status, 200)
  assert.equal(await response.text(), "Actual note content")
  assert.equal(response.headers.get("content-disposition"), 'attachment; filename="notes.txt"')
  assert.equal(response.headers.get("x-content-type-options"), "nosniff")
  assert.equal(response.headers.get("content-security-policy"), "sandbox")
  assert.equal((await download.GET({ nextUrl: new URL("http://localhost/file?preview=1") }, { params: Promise.resolve({ id: note.id }) })).headers.get("content-disposition"), 'inline; filename="notes.txt"')
  assert.equal((await download.GET({ nextUrl: new URL("http://localhost/file") }, { params: Promise.resolve({ id: "missing" }) })).status, 404)
  userId = null
  assert.equal((await download.GET({}, { params: Promise.resolve({ id: note.id }) })).status, 401)
})
