import assert from "node:assert/strict"
import { test } from "node:test"
import { buildSearchResults, searchCatalog } from "../../packages/frontend/lib/globalSearch.ts"

test("global search matches titles and codes, excludes malformed rows, and encodes working destination links", () => {
  const results = buildSearchResults("  ALG  ", [{ id: "a/b", title: "Algorithms" }, { title: "Algorithms" }, null], [{ subjectName: "CS / Algorithms", subjectCode: "ALG1" }], [{ name: "Algorithms", code: "CS1" }, { name: "Algorithms" }])
  assert.deepEqual(results.map(result => result.href), ["/dashboard/exams/a%2Fb", "/subjects/CS%20%2F%20Algorithms", "/resources?subject=Algorithms"])
  assert.equal(buildSearchResults(" ", [], [], []).length, 0)
  assert.equal(buildSearchResults("missing", [], [], []).length, 0)
})

test("search uses all live APIs and preserves partial results while reporting failed sources", async () => {
  const urls: string[] = []
  const controller = new AbortController()
  const result = await searchCatalog("math", controller.signal, async (url, options) => {
    urls.push(String(url))
    assert.equal(options?.signal, controller.signal)
    if (String(url).includes("exams")) return new Response(JSON.stringify({ success: true, exams: [{ id: "1", title: "Math" }] }))
    if (String(url).includes("resources")) return new Response("broken", { status: 500 })
    return new Response(JSON.stringify({ subjects: [{ subjectName: "Mathematics" }] }))
  })
  assert.deepEqual(urls, ["/api/exams/list", "/api/subjects", "/api/resources?action=subjects"])
  assert.equal(result.results.length, 2)
  assert.deepEqual(result.errors, ["Could not search resources. Please try again."])
})

test("cancelled searches reject instead of reporting stale source errors", async () => {
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(searchCatalog("math", controller.signal, async () => { throw new Error("aborted") }), /aborted/)
})
