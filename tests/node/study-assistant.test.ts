import assert from "node:assert/strict"
import { test } from "node:test"
import { requestStudyAnswer } from "../../packages/frontend/lib/studyAssistant.ts"

test("study assistant sends trimmed questions and displays the actual answer", async () => {
  const answer = await requestStudyAnswer("  Explain trees  ", async (url, options) => {
    assert.equal(url, "/api/llm")
    assert.equal(options?.method, "POST")
    assert.deepEqual(JSON.parse(String(options?.body)), { inputMessage: "Explain trees" })
    return new Response(JSON.stringify({ success: true, result: "Trees have nodes and edges." }))
  })
  assert.equal(answer, "Trees have nodes and edges.")
})
test("study assistant reports HTTP, malformed, empty, and network failures", async () => {
  await assert.rejects(requestStudyAnswer("test", async () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })), /Unauthorized/)
  await assert.rejects(requestStudyAnswer("test", async () => new Response("not json")), /unavailable/)
  await assert.rejects(requestStudyAnswer("test", async () => new Response(JSON.stringify({ success: true, result: " " }))), /empty response/)
  await assert.rejects(requestStudyAnswer("test", async () => { throw new Error("Network unavailable") }), /Network unavailable/)
})
