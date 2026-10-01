/**
 * Pure derivations for the dashboard. Kept free of React and of `fetch` so they
 * can be unit tested directly.
 */

export interface SubmissionView {
  submissionId?: string
  examId?: string
  title?: string
  totalMarks?: number | null
  marksAchieved?: number | null
  submittedAt?: string | Date | null
}

/** Accepts only real finite numbers. `null`, `undefined` and `""` are absent, not zero. */
export function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === "string")
}

/** A submission counts only when it has both a score and a positive total. */
export function submissionPercentage(submission: SubmissionView): number | null {
  const achieved = toFiniteNumber(submission?.marksAchieved)
  const total = toFiniteNumber(submission?.totalMarks)
  if (achieved === null || total === null || total <= 0) return null
  return (achieved / total) * 100
}

export function submissionStatus(submission: SubmissionView): 'Completed' | 'Submitted' {
  return toFiniteNumber(submission?.marksAchieved) === null ? 'Submitted' : 'Completed'
}

/** Mean of the scored submissions, or `null` when nothing has been graded yet. */
export function averageScore(submissions: SubmissionView[]): number | null {
  const values: number[] = []
  for (const submission of submissions) {
    const percentage = submissionPercentage(submission)
    if (percentage !== null) values.push(percentage)
  }
  if (values.length === 0) return null
  return Math.round((values.reduce((total, value) => total + value, 0) / values.length) * 10) / 10
}

export function examIdOf(item: { examId?: unknown; id?: unknown; _id?: unknown }): string | null {
  for (const candidate of [item?.examId, item?.id, item?._id]) {
    if (typeof candidate === 'string' && candidate !== '') return candidate
    if (candidate && typeof (candidate as { toString?: () => string }).toString === 'function') {
      const asString = String(candidate)
      if (asString !== '' && asString !== '[object Object]') return asString
    }
  }
  return null
}

/**
 * Unique exam count across allocations and submissions.
 *
 * Summing the two arrays counted any exam that appeared in both twice, which is
 * every exam a student has already taken.
 */
export function uniqueExamCount(
  allocatedExams: Array<Record<string, unknown>>,
  submissions: SubmissionView[],
): number {
  const ids = new Set<string>()
  for (const exam of allocatedExams) {
    const id = examIdOf(exam)
    ids.add(id ?? `__index_${ids.size}`)
  }
  for (const submission of submissions) {
    const id = examIdOf(submission)
    if (id) ids.add(id)
  }
  return ids.size
}

function submittedAtValue(submission: SubmissionView): number {
  const raw = submission?.submittedAt
  if (!raw) return 0
  const time = raw instanceof Date ? raw.getTime() : new Date(raw).getTime()
  return Number.isFinite(time) ? time : 0
}

/** Newest submission first. The API returns them keyed by id, not by time. */
export function sortBySubmittedAtDesc(submissions: SubmissionView[]): SubmissionView[] {
  return [...submissions].sort((a, b) => {
    const delta = submittedAtValue(b) - submittedAtValue(a)
    if (delta !== 0) return delta
    return String(a?.submissionId ?? '').localeCompare(String(b?.submissionId ?? ''))
  })
}

export function recentSubmissions(submissions: SubmissionView[], limit = 6): SubmissionView[] {
  return sortBySubmittedAtDesc(submissions).slice(0, limit)
}

/** Card key. `examId` is not on the submission shape, so it degrades to the index. */
export function submissionKey(submission: SubmissionView, index: number): string {
  return submission?.submissionId || `${examIdOf(submission ?? {}) ?? 'submission'}-${index}`
}

export function formatPercentage(submission: SubmissionView): string {
  const percentage = submissionPercentage(submission)
  return percentage === null ? 'N/A' : `${percentage.toFixed(2)}%`
}

/** Case-insensitive search that never throws on a record without a title. */
export function matchesSearch(exam: Record<string, unknown>, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  const haystacks = [exam?.title, exam?.description, exam?.subject]
  return haystacks.some(
    (value) => typeof value === 'string' && value.toLowerCase().includes(needle),
  )
}

export function filterExams<T extends Record<string, unknown>>(exams: T[], query: string): T[] {
  return (Array.isArray(exams) ? exams : []).filter((exam) => matchesSearch(exam, query))
}

/**
 * Whether a fetch failure is worth another attempt. 4xx answers are the server's
 * final word - retrying them only delays the error the user has to see.
 */
export function isRetryableStatus(status: number): boolean {
  return !(status >= 400 && status < 500)
}

export interface UserInfoResponse {
  success: boolean
  data?: {
    id: string
    email: string
    role: string
    currentAllocatedExams: string[]
    submissionHistory: string[]
  }
}

export function readUserInfo(payload: unknown): UserInfoResponse | null {
  if (!payload || typeof payload !== 'object') return null
  const body = payload as { success?: unknown; data?: unknown }
  if (body.success !== true || !body.data || typeof body.data !== 'object') return null
  return body as UserInfoResponse
}

export type ExamStatus = 'active' | 'scheduled' | 'draft'

/**
 * Exam status derived from the schedule. `/api/exams/list` hard-codes every exam
 * to `active`, so the detail page derived it the same way the data implies
 * instead of inventing one.
 */
export function examStatusOf(exam: { scheduledAt?: string | Date | null }): ExamStatus {
  const scheduledAt = exam?.scheduledAt
  if (scheduledAt == null) return 'draft'
  const time = scheduledAt instanceof Date ? scheduledAt.getTime() : new Date(scheduledAt).getTime()
  if (!Number.isFinite(time)) return 'draft'
  return time > Date.now() ? 'scheduled' : 'active'
}