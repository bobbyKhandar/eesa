import assert from "node:assert/strict"
import { test } from "node:test"
import { analyticsCsv, analyticsReport, filterAnalytics } from "../../packages/frontend/lib/performanceAnalytics.ts"

const rows: any[] = [
  { id: "zero", examName: '=HYPERLINK("bad")', subject: "Math", date: "2026-10-01", score: 0, totalMarks: 20, percentage: 0, status: "failed" },
  { id: "pass", examName: "Trees, graphs", subject: "CS", date: "2026-09-01", score: 18, totalMarks: 20, percentage: 90, status: "passed" },
]
test("analytics applies date and subject filters to real rows including zero scores", () => {
  assert.equal(filterAnalytics(rows, "Math", "all").length, 1)
  assert.deepEqual(filterAnalytics(rows, "all", "week", new Date("2026-10-04")).map(row => row.id), ["zero"])
  assert.equal(filterAnalytics(rows, "Missing", "all").length, 0)
})
test("CSV escapes commas, quotes and spreadsheet formulas while preserving numeric zero", () => {
  const csv = analyticsCsv(rows)
  assert.ok(csv.includes('"\'=HYPERLINK(""bad"")"'))
  assert.ok(csv.includes('"Trees, graphs"'))
  assert.ok(csv.includes('"0","20","0","failed"'))
})
test("reports calculate their summary from the supplied filtered results", () => {
  const report = analyticsReport(filterAnalytics(rows, "CS", "all"), "CS", "all")
  assert.match(report, /Exams: 1/)
  assert.match(report, /Average score: 90%/)
  assert.match(report, /Pass rate: 100%/)
  assert.doesNotMatch(report, /HYPERLINK/)
  assert.match(analyticsReport([], "all", "all"), /Exams: 0/)
})
