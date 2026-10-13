/**
 * Export and share helpers for data a results or published-report page
 * already holds. The pages download these strings; they do not invent a file
 * that was never loaded (the stored original is often an s3:// URL).
 */

import { toBloomRows } from "./bloomDistribution"

export const RESULT_CSV_HEADER =
  "Exam,Subject,Date,Score,Total Marks,Percentage,Grade,Status,Duration"

export type ShareCopyStatus = "idle" | "copied" | "failed"

export interface ResultCsvRow {
  examName: string
  subject: string
  date: unknown
  score: number
  totalMarks: number
  percentage: number
  grade: string
  status: string
  duration?: string
}

export interface TextDownload {
  fileName: string
  contents: string
  mimeType: string
}

export interface ReportDownloadQuestion {
  questionText: string
  bloomsLevel?: string
  topic?: string
}

export interface ReportDownloadInput {
  subjectName: string
  originalFileName: string
  year: string
  semester: string
  examType: string
  subjectCode?: string
  branch?: string
  totalQuestions: number
  totalMarks?: number
  publishedAt: string
  overallAssessment?: string
  bloomDistribution: unknown
  questions?: ReportDownloadQuestion[]
  tags?: string[]
}

interface ClipboardWriter {
  writeText?: (value: string) => Promise<void>
}

function slugFilePart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
}

/** Calendar date for an ISO timestamp; anything else is kept as text. */
export function formatExportDate(value: unknown): string {
  if (value == null) return ""
  if (typeof value === "string") {
    const isoDay = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim())
    if (isoDay) return isoDay[1]
  }
  const date = value instanceof Date ? value : new Date(value as string | number)
  if (Number.isNaN(date.getTime())) return typeof value === "string" ? value : ""
  return date.toISOString().slice(0, 10)
}

function formatNumber(value: unknown): string {
  const number = typeof value === "number" ? value : Number(value)
  return Number.isFinite(number) ? String(number) : ""
}

/** Quote RFC 4180 specials and neutralize cells a spreadsheet would execute. */
function escapeCsvCell(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  if (/[",\r\n]/.test(guarded)) return `"${guarded.replace(/"/g, '""')}"`
  return guarded
}

export function resultsToCsv(rows: readonly ResultCsvRow[]): string {
  const lines = [RESULT_CSV_HEADER]
  for (const row of rows) {
    lines.push(
      [
        row.examName,
        row.subject,
        formatExportDate(row.date),
        formatNumber(row.score),
        formatNumber(row.totalMarks),
        formatNumber(row.percentage),
        row.grade,
        row.status,
        row.duration ?? "",
      ]
        .map((cell) => escapeCsvCell(String(cell)))
        .join(",")
    )
  }
  return `${lines.join("\r\n")}\r\n`
}

export function resultCsvFileName(examName: string): string {
  const slug = slugFilePart(examName)
  return slug ? `exam-result-${slug}.csv` : "exam-result.csv"
}

export function resultsDownload(rows: readonly ResultCsvRow[], fileName: string): TextDownload {
  return {
    fileName,
    contents: resultsToCsv(rows),
    mimeType: "text/csv;charset=utf-8",
  }
}

export function shareButtonLabel(status: ShareCopyStatus): string {
  if (status === "copied") return "Link copied"
  if (status === "failed") return "Copy failed"
  return "Share"
}

/** Copy a page URL. A missing clipboard or a blank URL is a failed copy. */
export async function copyPageLink(
  href: string,
  clipboard: ClipboardWriter | null | undefined,
): Promise<Exclude<ShareCopyStatus, "idle">> {
  const value = href.trim()
  if (!value || !clipboard?.writeText) return "failed"
  try {
    await clipboard.writeText(value)
    return "copied"
  } catch {
    return "failed"
  }
}

function examTypeLabel(examType: string): string {
  if (examType === "main") return "Main Exam"
  if (examType === "kt") return "KT Exam"
  return examType
}

function reportFileName(subjectName: string): string {
  const slug = slugFilePart(subjectName)
  return slug ? `${slug}-report.txt` : "report.txt"
}

function formatQuestionLine(index: number, question: ReportDownloadQuestion): string {
  const labels = [question.bloomsLevel, question.topic].filter(
    (part): part is string => Boolean(part && part.trim())
  )
  const prefix = labels.length > 0 ? ` [${labels.join("] [")}]` : ""
  return `${index + 1}.${prefix} ${question.questionText}`
}

/** Plain-text snapshot of the published report the page is already showing. */
export function reportToPlainText(report: ReportDownloadInput): string {
  const lines = [
    `Subject: ${report.subjectName.trim() || "Untitled"}`,
    `File: ${report.originalFileName}`,
    `Year: ${report.year}`,
    `Semester: ${report.semester}`,
    `Exam type: ${examTypeLabel(report.examType)}`,
  ]
  if (report.subjectCode) lines.push(`Subject code: ${report.subjectCode}`)
  if (report.branch) lines.push(`Branch: ${report.branch}`)
  lines.push(`Questions: ${report.totalQuestions}`)
  if (report.totalMarks != null) lines.push(`Total marks: ${report.totalMarks}`)
  lines.push(`Published: ${formatExportDate(report.publishedAt)}`)
  lines.push("")

  if (report.overallAssessment) {
    lines.push("Overall assessment")
    lines.push(report.overallAssessment)
    lines.push("")
  }

  lines.push("Questions")
  if (!report.questions || report.questions.length === 0) {
    lines.push("No questions")
  } else {
    report.questions.forEach((question, index) => {
      lines.push(formatQuestionLine(index, question))
    })
  }
  lines.push("")
  lines.push("Bloom's distribution")
  for (const row of toBloomRows(report.bloomDistribution)) {
    lines.push(`${row.level}: ${row.percentage.toFixed(1)}%`)
  }
  if (report.tags && report.tags.length > 0) {
    lines.push("")
    lines.push(`Tags: ${report.tags.join(", ")}`)
  }
  return `${lines.join("\r\n")}\r\n`
}

export function reportDownload(report: ReportDownloadInput): TextDownload {
  return {
    fileName: reportFileName(report.subjectName),
    contents: reportToPlainText(report),
    mimeType: "text/plain;charset=utf-8",
  }
}

/** Browser-only. Tests cover the TextDownload value this writes. */
export function triggerTextDownload(download: TextDownload): void {
  const blob = new Blob([download.contents], { type: download.mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = download.fileName
  anchor.rel = "noopener"
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
