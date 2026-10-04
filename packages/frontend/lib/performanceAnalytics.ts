import { isWithinDateWindow, summarizeResults, type DateFilter, type ResultRow } from "./examResults.ts"

export function filterAnalytics(rows: ResultRow[], subject: string, date: DateFilter, now = new Date()) {
  return rows.filter(row => (subject === "all" || row.subject === subject) && isWithinDateWindow(row.date, date, now))
}

function csvCell(value: unknown) {
  let text = value == null ? "" : String(value)
  // Treat spreadsheet formulas as text when exporting user-supplied labels.
  if (typeof value === "string" && /^[=+@\-\t\r]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

export function analyticsCsv(rows: ResultRow[]) {
  return [["Exam", "Subject", "Date", "Score", "Total marks", "Percentage", "Status"], ...rows.map(row => [row.examName, row.subject, row.date, row.score, row.totalMarks, row.percentage, row.status])].map(row => row.map(csvCell).join(",")).join("\r\n")
}

export function analyticsReport(rows: ResultRow[], subject: string, date: DateFilter) {
  const stats = summarizeResults(rows)
  return `Performance Report\nSubject: ${subject === "all" ? "All subjects" : subject}\nDate range: ${date}\nExams: ${stats.totalExams}\nAverage score: ${stats.avgScore}%\nPassed exams: ${stats.passedExams}\nPass rate: ${stats.passRate}%\nHighest score: ${stats.highestScore}%\n\n${rows.map(row => `${row.examName} — ${row.subject}: ${row.score}/${row.totalMarks} (${row.percentage}%), ${row.status}`).join("\n")}\n`
}

export function downloadAnalytics(content: string, filename: string, contentType: string) {
  const url = URL.createObjectURL(new Blob([content], { type: contentType }))
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
