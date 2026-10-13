/**
 * Preview and download helpers for previous-year questions the resources
 * page already holds. The table downloads this CSV; it does not fetch a
 * paper file that was never loaded.
 */

export const PYQ_CSV_HEADER =
  "Question,Year,Frequency,Difficulty,Bloom's Level,Topics,Exam Type"

export interface PyqExportRow {
  title?: string
  questionText: string
  year?: string
  years?: string[]
  frequency?: number
  occurrenceCount?: number
  difficulty?: string
  bloomsLevel?: string
  topic?: string
  topics?: string[]
  examType?: string
}

export interface PyqPreview {
  title: string
  questionText: string
  yearsLabel: string
  frequencyLabel: string
  difficulty: string
  bloomsLevel: string
  topicsLabel: string
  examType: string
}

export interface PyqTextDownload {
  fileName: string
  contents: string
  mimeType: string
}

function slugFilePart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? String(value) : ""
}

/** Quote RFC 4180 specials and neutralize cells a spreadsheet would execute. */
function escapeCsvCell(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  if (/[",\r\n]/.test(guarded)) return `"${guarded.replace(/"/g, '""')}"`
  return guarded
}

function examTypeLabel(examType: string | undefined): string {
  if (!examType?.trim()) return ""
  if (examType === "main") return "Main Exam"
  if (examType === "kt") return "KT Exam"
  return examType
}

function yearsText(row: PyqExportRow): string {
  const years = (row.years ?? []).map((year) => year.trim()).filter(Boolean)
  if (years.length > 0) return years.join(", ")
  return row.year?.trim() ?? ""
}

function topicsText(row: PyqExportRow): string {
  const topics = (row.topics ?? []).map((topic) => topic.trim()).filter(Boolean)
  if (topics.length > 0) return topics.join(", ")
  return row.topic?.trim() ?? ""
}

function frequencyValue(row: PyqExportRow): number {
  if (typeof row.frequency === "number" && Number.isFinite(row.frequency)) return row.frequency
  if (typeof row.occurrenceCount === "number" && Number.isFinite(row.occurrenceCount)) {
    return row.occurrenceCount
  }
  return 0
}

export function pyqCsvFileName(subjectName: string): string {
  const slug = slugFilePart(subjectName)
  return slug ? `${slug}-pyqs.csv` : "pyqs.csv"
}

export function pyqsToCsv(rows: readonly PyqExportRow[]): string {
  const lines = [PYQ_CSV_HEADER]
  for (const row of rows) {
    lines.push(
      [
        row.questionText ?? "",
        yearsText(row),
        formatNumber(frequencyValue(row)),
        row.difficulty?.trim() ?? "",
        row.bloomsLevel?.trim() ?? "",
        topicsText(row),
        examTypeLabel(row.examType),
      ]
        .map((cell) => escapeCsvCell(cell))
        .join(",")
    )
  }
  return `${lines.join("\r\n")}\r\n`
}

export function pyqsDownload(rows: readonly PyqExportRow[], subjectName: string): PyqTextDownload {
  return {
    fileName: pyqCsvFileName(subjectName),
    contents: pyqsToCsv(rows),
    mimeType: "text/csv;charset=utf-8",
  }
}

/** Labels shown in the preview dialog. Difficulty matches the table badge. */
export function describePyq(row: PyqExportRow): PyqPreview {
  const years = yearsText(row)
  return {
    title: row.title?.trim() || "Question",
    questionText: row.questionText ?? "",
    yearsLabel: years || "N/A",
    frequencyLabel: `${frequencyValue(row)}×`,
    difficulty: row.difficulty?.trim() || "Medium",
    bloomsLevel: row.bloomsLevel?.trim() ?? "",
    topicsLabel: topicsText(row),
    examType: examTypeLabel(row.examType),
  }
}
