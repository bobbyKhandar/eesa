"use client"
import Link from "next/link"
import { useState, useEffect } from "react"
import { Button } from "@/frontend/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/frontend/components/ui/card"
import { BookOpen, FileText, BarChart3, Plus } from "lucide-react"
import { SignedOut, SignedIn, useUser } from "@clerk/nextjs"
import { SignInButton } from "@clerk/nextjs"
import { ArrowRight } from "lucide-react"

export default function DashboardPage() {
  const [submissions, setSubmissions] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { user } = useUser()

  // Load user's graded submissions
  useEffect(() => {
    const email = user?.emailAddresses?.[0]?.emailAddress
    if (!email) return

    setLoading(true)
    setError(null)

    fetch(`/api/users/submissions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    })
      .then(async (r) => {
        const data = await r.json().catch(() => ({ success: false }))
        if (!r.ok || !data?.success) throw new Error(data?.error || "Failed to fetch submissions")
        setSubmissions(Array.isArray(data.submissions) ? data.submissions : [])
      })
      .catch((e) => setError(e.message || String(e)))
      .finally(() => setLoading(false))
  }, [user?.emailAddresses])

  // Derived metrics from submissions
  const totalExams = submissions.length
  const completedExams = submissions.filter(s => !!s.evaluatedAt).length
  const avgScore = (() => {
    const vals = submissions
      .map((s) => {
        if (typeof s.percentage === "number") return s.percentage
        if (s.obtainedMarks != null && s.totalMarks) return (s.obtainedMarks / s.totalMarks) * 100
        return undefined
      })
      .filter((v): v is number => typeof v === "number" && !Number.isNaN(v))
    if (vals.length === 0) return 0
    return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10
  })()

  // Recent: newest first
  const recent = [...submissions]
    .sort((a, b) => {
      const da = new Date(a.evaluatedAt || a.submittedAt || 0).getTime()
      const db = new Date(b.evaluatedAt || b.submittedAt || 0).getTime()
      return db - da
    })
    .slice(0, 6)

  return (
    <div className="space-y-6">
      <SignedOut>
        <div className="flex flex-col items-center justify-center h-screen">
          <h1 className="text-2xl font-bold mb-4">Please sign in to access the dashboard</h1>
          <SignInButton>
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
              <p className="text-xs text-gray-500 dark:text-gray-400">Total submissions recorded</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Completed Exams</CardTitle>
              <FileText className="h-4 w-4 text-gray-500 dark:text-gray-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{completedExams}</div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Evaluated with results</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Average Score</CardTitle>
              <BarChart3 className="h-4 w-4 text-gray-500 dark:text-gray-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{avgScore}%</div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Across completed exams</p>
            </CardContent>
          </Card>
        </div>

        <h2 className="text-xl font-bold mt-8">Recent Exams</h2>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {recent.length === 0 && !loading && !error && (
            <Card>
              <CardHeader>
                <CardTitle>No recent submissions</CardTitle>
                <CardDescription>Complete an exam to see it here</CardDescription>
              </CardHeader>
            </Card>
          )}

          {recent.map((s) => {
            const dt = new Date(s.evaluatedAt || s.submittedAt || Date.now())
            const dateStr = dt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
            const status = s.evaluatedAt ? "Completed" : "Submitted"
            const score =
              typeof s.percentage === "number"
                ? `${Math.round(s.percentage)}%`
                : s.totalMarks
                ? `${s.obtainedMarks ?? 0}/${s.totalMarks}`
                : "—"

            return (
              <Card key={s._id}>
                <CardHeader>
                  <CardTitle>{s.examTitle || `Exam ${s.examId}`}</CardTitle>
                  <CardDescription>{status} on {dateStr}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-sm">
                    <p>Score: {score}{s.grade ? ` (${s.grade})` : ""}</p>
                    <p>
                      Status:{" "}
                      <span className={status === "Completed" ? "text-blue-500" : "text-yellow-600"}>{status}</span>
                    </p>
                  </div>
                </CardContent>
                <CardFooter>
                  <Link href={`/results/${s.examId}`} className="w-full">
                    <Button variant="outline" className="w-full">
                      View Result
                    </Button>
                  </Link>
                </CardFooter>
              </Card>
            )
          })}
        </div>
      </SignedIn>
    </div>
  )
}
