"use client"
import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { Button } from "@/frontend/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/frontend/components/ui/card"
import {
  averageScore,
  formatPercentage,
  isRetryableStatus,
  readUserInfo,
  recentSubmissions,
  submissionKey,
  submissionStatus,
  uniqueExamCount,
  type SubmissionView,
} from "@/frontend/lib/dashboardMetrics"
import { BookOpen, FileText, BarChart3, Plus } from "lucide-react"
import { SignedOut, SignedIn, useUser } from "@clerk/nextjs"
import { SignInButton } from "@clerk/nextjs"
import { ArrowRight } from "lucide-react"

const MAX_RETRIES = 3

/**
 * Retry only transport faults and 5xx. A 4xx - including the 404 that triggers
 * provisioning - is the server's final answer, so it is returned immediately
 * instead of adding ~3s of backoff to a real error.
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = MAX_RETRIES
): Promise<Response> {
  let lastError: Error | null = null
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, options)
      if (response.ok || !isRetryableStatus(response.status)) return response
      lastError = new Error(`HTTP ${response.status}`)
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error
      lastError = error instanceof Error ? error : new Error(String(error))
    }
    if (attempt < maxRetries - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, attempt)))
    }
  }
  throw lastError
}

/** Read the caller's record. Absolute URL: a relative path resolves against the route. */
async function loadUserInfo(signal: AbortSignal) {
  return fetchWithRetry("/api/users/userInfo", { signal, cache: "no-store" })
}

async function loadExamSet(submissionId: string, signal: AbortSignal) {
  const response = await fetchWithRetry(
    `/api/users/submissions/${encodeURIComponent(submissionId)}/examDetails`,
    { signal, cache: "no-store" }
  )
  if (!response.ok) return null
  const body = await response.json().catch(() => null)
  const examSet = body?.examSet
  if (!examSet || typeof examSet !== "object") return null
  return { ...examSet, submissionId }
}

export default function DashboardPage() {
  const [submissions, setSubmissions] = useState<SubmissionView[]>([])
  const [allocatedExams, setAllocatedExams] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { user, isLoaded } = useUser()

  const load = useCallback(async (clerkUser: NonNullable<typeof user>, signal: AbortSignal) => {
    const userId = clerkUser.id
    setLoading(true)
    setError(null)

    // Read first. The page used to POST to /api/users/create on every visit just
    // to read state, which made every render a write and hid provisioning bugs.
    let infoResponse = await loadUserInfo(signal)

    if (infoResponse.status === 404) {
      const created = await fetchWithRetry(
        "/api/users/create",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // Only the Clerk-owned identity. The role is the server's decision -
          // sending `role` let the client pick it.
          body: JSON.stringify({
            user: {
              id: userId,
              emailAddresses: clerkUser.emailAddresses,
              fullName: clerkUser.fullName,
              imageUrl: clerkUser.imageUrl,
            },
          }),
          signal,
        }
      )
      const createdBody = await created.json().catch(() => null)
      if (!created.ok || !createdBody?.success) {
        throw new Error(createdBody?.error || "Failed to load dashboard data")
      }
      infoResponse = await loadUserInfo(signal)
    }

    if (!infoResponse.ok) {
      const body = await infoResponse.json().catch(() => null)
      throw new Error(body?.error || `Failed to load dashboard data (HTTP ${infoResponse.status})`)
    }

    const info = readUserInfo(await infoResponse.json())
    if (!info?.data) throw new Error("Dashboard data was not in the expected shape")

    setAllocatedExams(
      (info.data.currentAllocatedExams ?? []).map((examId) => ({ examId }))
    )

    const results = await Promise.all(
      (info.data.submissionHistory ?? []).map((submissionId) =>
        loadExamSet(submissionId, signal)
      )
    )
    setSubmissions(results.filter((entry): entry is SubmissionView => entry !== null))
  }, [])

  useEffect(() => {
    // Wait for Clerk to resolve. Returning early on a missing user left the
    // previous account's data on screen after a sign-out or account switch.
    if (!isLoaded) return

    if (!user?.id) {
      setSubmissions([])
      setAllocatedExams([])
      setError(null)
      setLoading(false)
      return
    }

    const controller = new AbortController()
    let active = true

    load(user, controller.signal)
      .catch((cause: unknown) => {
        if (!active || controller.signal.aborted) return
        setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    // An aborted request is not a failure to report, and a slow reply for one
    // account must never overwrite the next one's.
    return () => {
      active = false
      controller.abort()
    }
  }, [isLoaded, user?.id, load])

  const totalExams = uniqueExamCount(allocatedExams, submissions)
  const recentExams = recentSubmissions(submissions)
  // Derived, not stored: the old avgScore state held a placeholder string until
  // the first result arrived, which leaked into the rendered percentage.
  const avgScore = averageScore(submissions)

  return (
    <div className="space-y-6">
      <SignedOut>
        <div className="flex flex-col items-center justify-center h-screen">
          <h1 className="text-2xl font-bold mb-4">Please sign in to access the dashboard</h1>
          <SignInButton mode="modal" forceRedirectUrl="/dashboard">
            <Button size="lg" className="gap-1">
              Sign in <ArrowRight className="h-4 w-4" />
            </Button>
          </SignInButton>
        </div>
      </SignedOut>

      <SignedIn>
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <Link href="/dashboard/exams/create">
            <Button className="gap-2">
              <Plus className="h-4 w-4" /> Create Exam
            </Button>
          </Link>
        </div>

        {loading && <div className="text-sm text-gray-500 dark:text-gray-400">Loading…</div>}
        {error && <div className="text-sm text-red-500">Error: {error}</div>}

        <div className="grid gap-6 md:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Total Exams</CardTitle>
              <BookOpen className="h-4 w-4 text-gray-500 dark:text-gray-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totalExams}</div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Allocated and submitted exams</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Completed Exams</CardTitle>
              <FileText className="h-4 w-4 text-gray-500 dark:text-gray-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{submissions.length}</div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Exam attempts recorded</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Average Score</CardTitle>
              <BarChart3 className="h-4 w-4 text-gray-500 dark:text-gray-400" />
            </CardHeader>
            <CardContent>
              {/* Derived, not stored: the old avgScore state was seeded with a
                  placeholder string, which rendered as a literal percentage and
                  then as 0% once the list emptied. */}
              <div className="text-2xl font-bold">
                {avgScore === null ? "—" : `${avgScore}%`}
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Across graded exams</p>
            </CardContent>
          </Card>
        </div>

        <h2 className="text-xl font-bold mt-8">Recent Exams</h2>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {recentExams.length === 0 && !loading && !error && (
            <Card>
              <CardHeader>
                <CardTitle>No recent submissions</CardTitle>
                <CardDescription>Complete an exam to see it here</CardDescription>
              </CardHeader>
            </Card>
          )}

          {recentExams.map((s, i) => {
            const dateStr = s.submittedAt
              ? new Date(s.submittedAt).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })
              : "Unknown date"
            // `evaluatedAt` and `grade` are not on the submission document, so
            // every card used to read "Submitted" and never showed a grade.
            const status = submissionStatus(s)
            const score = formatPercentage(s)

            return (
              <Card key={submissionKey(s, i)}>
                <CardHeader>
                  <CardTitle>{s.title || "Untitled exam"}</CardTitle>
                  <CardDescription>
                    {status} on {dateStr}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-sm">
                    <p>Score: {score}</p>
                    <p>
                      Status:{" "}
                      <span className={status === "Completed" ? "text-blue-500" : "text-yellow-600"}>
                        {status}
                      </span>
                    </p>
                  </div>
                </CardContent>
                {s.submissionId && (
                  <CardFooter>
                    <Link href={`/results/${s.submissionId}`} className="w-full">
                      <Button variant="outline" className="w-full">
                        View Result
                      </Button>
                    </Link>
                  </CardFooter>
                )}
              </Card>
            )
          })}
        </div>
      </SignedIn>
    </div>
  )
}