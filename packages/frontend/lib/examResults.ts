/**
 * Pure derivations for the submit -> grade -> results flow.
 *
 * Every rule that used to be hardcoded inside an API route or a page lives
 * here so the same number is produced everywhere:
 *
 *   - the pass threshold comes from `exam.passingPercentage`, not from a
 *     literal 40 in `/api/results` and a literal 60 in `/results/[id]`
 *   - a percentage is never `NaN` / `Infinity` when `maxMarks` is 0
 *   - "subject" is `exam.subject`; `examDegree` is the degree programme
 *   - the trend chart is chronological and keyed by year + month
 *   - the exam time limit is derived from `exam.duration` and enforced on the
 *     server, so `autoSubmitted` cannot be claimed as a normal submission
 *
 * The API routes, the take-exam page and the results pages all import from
 * here; there is no second copy of any of these rules.
 */

/** Used only when an exam carries no usable `passingPercentage`. */
export const DEFAULT_PASSING_PERCENTAGE = 40

/** Used only when an exam carries no usable `duration`. */
export const DEFAULT_EXAM_DURATION_MINUTES = 60

/** Longest window the "This Semester" filter spans. */
export const SEMESTER_DAYS = 120

const GRADE_CUTOFFS: ReadonlyArray<readonly [number, string]> = [
  [90, "A+"],
  [80, "A"],
  [70, "B+"],
  [60, "B"],
  [50, "C+"],
  [40, "C"],
]

const GRADE_ORDER = ["A+", "A", "B+", "B", "C+", "C", "F"] as const

const GRADE_COLORS: Record<string, string> = {
  "A+": "#00ff00",
  A: "#8884d8",
  "B+": "#82ca9d",
  B: "#ffc658",
  "C+": "#ff7300",
  C: "#ff9900",
  F: "#ff0000",
}

const SUBJECT_COLORS = ["#8884d8", "#82ca9d", "#ffc658", "#ff7300", "#00ff00", "#ff00ff", "#00ffff"]

/** Date filters offered by the results table. */
export type DateFilter = "all" | "week" | "month" | "semester"

const DATE_FILTER_DAYS: Record<Exclude<DateFilter, "all">, number> = {
  week: 7,
  month: 30,
  semester: SEMESTER_DAYS,
}

export interface ExamSummaryLike {
  examTitle?: unknown
  subject?: unknown
  examDegree?: unknown
  passingPercentage?: unknown
  examMaxMarks?: unknown
  duration?: unknown
}

export interface SubmissionLike {
  _id?: unknown
  examId?: unknown
  submittedAt?: unknown
  marksAchieved?: unknown
  maxMarks?: unknown
  timeSpent?: unknown
  autoSubmitted?: unknown
  evaluatorObservations?: unknown
  responses?: unknown
}

export interface ResultRow {
  id: string
  examId: string
  examName: string
  subject: string
  date: unknown
  score: number
  totalMarks: number
  percentage: number
  grade: string
  status: "passed" | "failed"
  passingPercentage: number
  duration: string
  autoSubmitted: boolean
  evaluatorObservations?: unknown
  responsesCount: number
}

export interface ResultsStats {
  totalExams: number
  passedExams: number
  failedExams: number
  avgScore: number
  highestScore: number
  passRate: number
}

export interface TrendPoint {
  month: string
  key: string
  score: number
  count: number
}

/** A finite number, or null. Rejects NaN, Infinity, booleans, objects and "" . */
export function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function toText(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim() !== "") return value
  return fallback
}

/** A valid Date, or null. Accepts Date, ISO strings and epoch numbers. */
function toDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }
  if (typeof value !== "string" && typeof value !== "number") return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * Score as a percentage of the available marks.
 *
 * Returns 0 rather than `NaN` or `Infinity` when `maxMarks` is missing, zero or
 * negative, which is what the results list, the results detail page and the
 * dashboard all divide by.
 */
export function scorePercentage(marksAchieved: unknown, maxMarks: unknown): number {
  const total = toFiniteNumber(maxMarks)
  const achieved = toFiniteNumber(marksAchieved) ?? 0
  if (total === null || total <= 0) return 0
  const percentage = (achieved / total) * 100
  return Number.isFinite(percentage) ? percentage : 0
}

/**
 * The exam's own pass threshold, clamped to 0-100.
 * Only an absent or unusable value falls back to {@link DEFAULT_PASSING_PERCENTAGE}.
 */
export function resolvePassingPercentage(exam?: ExamSummaryLike | null): number {
  const value = toFiniteNumber(exam?.passingPercentage)
  if (value === null) return DEFAULT_PASSING_PERCENTAGE
  return Math.min(100, Math.max(0, value))
}

export function verdictFor(
  percentage: unknown,
  passingPercentage: unknown = DEFAULT_PASSING_PERCENTAGE,
): "passed" | "failed" {
  const score = toFiniteNumber(percentage) ?? 0
  const threshold = toFiniteNumber(passingPercentage) ?? DEFAULT_PASSING_PERCENTAGE
  return score >= threshold ? "passed" : "failed"
}

export function gradeFor(percentage: unknown): string {
  const score = toFiniteNumber(percentage) ?? 0
  for (const [cutoff, grade] of GRADE_CUTOFFS) {
    if (score >= cutoff) return grade
  }
  return "F"
}

/** "1h 5m" / "5 minutes" / "N/A" for an unusable duration. */
export function formatDuration(seconds: unknown): string {
  const total = toFiniteNumber(seconds)
  if (total === null || total <= 0) return "N/A"

  const whole = Math.floor(total)
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)

  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
  return `${minutes} minutes`
}

/** One row of the results list, derived from a submission and its exam. */
export function buildResultRow(
  submission: SubmissionLike,
  exam?: ExamSummaryLike | null,
): ResultRow {
  const marksAchieved = toFiniteNumber(submission.marksAchieved) ?? 0
  const maxMarks = toFiniteNumber(submission.maxMarks) ?? 0
  const percentage = scorePercentage(marksAchieved, maxMarks)
  const passingPercentage = resolvePassingPercentage(exam)

  return {
    id: submission._id == null ? "" : String(submission._id),
    examId: submission.examId == null ? "" : String(submission.examId),
    // `subject` is the subject; `examDegree` is the degree programme. Reading
    // the degree here mislabelled every row and every subject chart.
    examName: toText(exam?.examTitle, "Unknown Exam"),
    subject: toText(exam?.subject, "General"),
    date: submission.submittedAt ?? null,
    score: marksAchieved,
    totalMarks: maxMarks,
    percentage: Math.round(percentage),
    grade: gradeFor(percentage),
    status: verdictFor(percentage, passingPercentage),
    passingPercentage,
    duration: formatDuration(submission.timeSpent),
    autoSubmitted: submission.autoSubmitted === true,
    evaluatorObservations: submission.evaluatorObservations,
    responsesCount: Array.isArray(submission.responses) ? submission.responses.length : 0,
  }
}

/** Newest first. Undated rows sort last instead of producing `NaN`. */
export function sortResultsByDateDesc(rows: ResultRow[]): ResultRow[] {
  const timeOf = (row: ResultRow): number => toDate(row.date)?.getTime() ?? 0
  return [...rows].sort((a, b) => timeOf(b) - timeOf(a))
}

export function summarizeResults(rows: ResultRow[]): ResultsStats {
  const totalExams = rows.length
  const passedExams = rows.filter((row) => row.status === "passed").length

  if (totalExams === 0) {
    return { totalExams: 0, passedExams: 0, failedExams: 0, avgScore: 0, highestScore: 0, passRate: 0 }
  }

  const sum = rows.reduce((total, row) => total + row.percentage, 0)
  return {
    totalExams,
    passedExams,
    failedExams: totalExams - passedExams,
    avgScore: Math.round(sum / totalExams),
    highestScore: Math.max(...rows.map((row) => row.percentage)),
    passRate: Math.round((passedExams / totalExams) * 100),
  }
}

/** `2025-03` - year and month, so January 2025 and January 2026 stay apart. */
function monthKeyOf(value: unknown): string | null {
  const date = toDate(value)
  if (!date) return null
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`
}

function monthLabelOf(key: string): string {
  const [year, month] = key.split("-")
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, 1))
  return date.toLocaleString("default", { month: "short", timeZone: "UTC" })
}

/**
 * Average score per calendar month, oldest first, limited to the `limit` most
 * recent months that actually hold a submission.
 *
 * The previous implementation keyed buckets on the month *name* only and then
 * took `.slice(-5)` of an object whose keys were inserted newest-first, so the
 * chart showed the five oldest months and merged every January it had ever
 * seen into one point.
 */
export function calculatePerformanceTrend(rows: ResultRow[], limit = 5): TrendPoint[] {
  const buckets = new Map<string, { total: number; count: number }>()

  for (const row of rows) {
    const key = monthKeyOf(row.date)
    if (!key) continue
    const bucket = buckets.get(key)
    if (bucket) {
      bucket.total += row.percentage
      bucket.count += 1
    } else {
      buckets.set(key, { total: row.percentage, count: 1 })
    }
  }

  return Array.from(buckets.entries())
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .slice(-Math.max(0, limit))
    .map(([key, { total, count }]) => ({
      month: monthLabelOf(key),
      key,
      score: Math.round(total / count),
      count,
    }))
}

/** Best subject first, so the palette and the "best / worst" cards agree. */
export function calculateSubjectPerformance(
  rows: ResultRow[],
): Array<{ subject: string; score: number; count: number; color: string }> {
  const buckets = new Map<string, { total: number; count: number }>()

  for (const row of rows) {
    const bucket = buckets.get(row.subject)
    if (bucket) {
      bucket.total += row.percentage
      bucket.count += 1
    } else {
      buckets.set(row.subject, { total: row.percentage, count: 1 })
    }
  }

  return Array.from(buckets.entries())
    .map(([subject, { total, count }]) => ({
      subject,
      average: total / count,
      count,
    }))
    .sort(
      (left, right) =>
        right.average - left.average || left.subject.localeCompare(right.subject),
    )
    .map((entry, index) => ({
      subject: entry.subject,
      score: Math.round(entry.average),
      count: entry.count,
      color: SUBJECT_COLORS[index % SUBJECT_COLORS.length],
    }))
}

/** Counts per grade, ordered A+ -> F. */
export function calculateGradeDistribution(
  rows: ResultRow[],
): Array<{ grade: string; count: number; color: string }> {
  const counts = new Map<string, number>()
  for (const row of rows) {
    counts.set(row.grade, (counts.get(row.grade) ?? 0) + 1)
  }

  return Array.from(counts.entries())
    .sort(([left], [right]) => {
      const leftIndex = GRADE_ORDER.indexOf(left as (typeof GRADE_ORDER)[number])
      const rightIndex = GRADE_ORDER.indexOf(right as (typeof GRADE_ORDER)[number])
      return (leftIndex < 0 ? GRADE_ORDER.length : leftIndex) -
        (rightIndex < 0 ? GRADE_ORDER.length : rightIndex)
    })
    .map(([grade, count]) => ({ grade, count, color: GRADE_COLORS[grade] ?? "#999999" }))
}

/**
 * Is `date` inside the selected window?
 *
 * A submission dated in the future is never "last week": the previous check
 * used `Math.abs(now - date)`, so a clock-skewed or pre-dated record matched
 * every relative filter.
 */
export function isWithinDateWindow(
  value: unknown,
  filter: DateFilter,
  now: Date = new Date(),
): boolean {
  if (filter === "all") return true

  const days = DATE_FILTER_DAYS[filter]
  if (days === undefined) return true

  const date = toDate(value)
  if (!date) return false

  const age = now.getTime() - date.getTime()
  if (age < 0) return false
  return age <= days * 24 * 60 * 60 * 1000
}

/** The exam time limit in seconds, with the documented default as fallback. */
export function examTimeLimitSeconds(durationMinutes: unknown): number {
  const minutes = toFiniteNumber(durationMinutes)
  if (minutes === null || minutes <= 0) return DEFAULT_EXAM_DURATION_MINUTES * 60
  return Math.floor(minutes * 60)
}

export interface ResolvedSubmissionTime {
  timeSpent: number
  autoSubmitted: boolean
}

/**
 * Server-side reading of how long an attempt took.
 *
 * The client's `autoSubmit` flag is accepted, but the recorded duration is
 * clamped to the exam's own limit and a submission that used up the whole
 * window is marked auto-submitted even if the client said otherwise. A
 * non-numeric or negative `timeSpent` is rejected instead of being stored,
 * because it renders as `NaN` in every duration column.
 */
export function resolveSubmissionTime(input: {
  durationMinutes?: unknown
  timeSpent?: unknown
  autoSubmit?: unknown
}): ResolvedSubmissionTime | { error: string } {
  const limit = examTimeLimitSeconds(input.durationMinutes)
  const spent = toFiniteNumber(input.timeSpent)

  if (spent === null) return { error: "timeSpent must be a number of seconds" }
  if (spent < 0) return { error: "timeSpent cannot be negative" }

  const timeSpent = Math.min(Math.floor(spent), limit)
  return { timeSpent, autoSubmitted: input.autoSubmit === true || timeSpent >= limit }
}

/**
 * Response for a second attempt at an exam the user has already submitted.
 * Carries the existing submission id so the client can open the real result
 * instead of showing an error the user cannot act on.
 */
export function duplicateSubmissionOutcome(existing?: {
  _id?: unknown
} | null): { status: number; error: string; submissionId?: string } {
  const submissionId = existing?._id == null ? undefined : String(existing._id)
  return {
    status: 409,
    error: "You have already submitted this exam",
    ...(submissionId ? { submissionId } : {}),
  }
}
