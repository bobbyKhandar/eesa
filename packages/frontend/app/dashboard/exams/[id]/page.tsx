"use client"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { Input } from "@/frontend/components/ui/input"
import { Button } from "@/frontend/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/frontend/components/ui/card"
import { Badge } from "@/frontend/components/ui/badge"
import { ArrowLeft, Clock, Users, FileText, BarChart3, Link2 } from "lucide-react"
import { examStatusOf, toFiniteNumber, toStringArray } from "@/frontend/lib/dashboardMetrics"

interface ExamDetail {
  _id?: string
  examTitle?: string
  examDescription?: string
  examMaxMarks?: number
  duration?: number
  passingPercentage?: number
  scheduledAt?: string
  createdAt?: string
  assignedUsers?: string[]
  questions?: unknown[]
}

function formatDate(value: string | undefined): string {
  if (!value) return "N/A"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "N/A"
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
}

export default function ExamDetailPage() {
  // `params` used to be read synchronously in a Server Component, so it was
  // always `undefined`. `useParams` is the Client Component equivalent.
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const examId = Array.isArray(params?.id) ? params?.id[0] : params?.id

  const [exam, setExam] = useState<ExamDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (!examId) {
      setError("Missing exam id")
      setLoading(false)
      return
    }

    const controller = new AbortController()
    let active = true

    const load = async () => {
      try {
        setLoading(true)
        setError(null)
        const response = await fetch(`/api/exams/${encodeURIComponent(examId)}`, {
          signal: controller.signal,
          cache: "no-store",
        })
        const body = await response.json()
        if (!response.ok || !body.success) {
          throw new Error(body.error || "Failed to load exam")
        }
        if (active) setExam(body.exam as ExamDetail)
      } catch (cause: any) {
        if (!active || controller.signal.aborted) return
        setError(cause.message || "Failed to load exam")
      } finally {
        if (active) setLoading(false)
      }
    }

    load()

    return () => {
      active = false
      controller.abort()
    }
  }, [examId])

  const handleDelete = async () => {
    if (!examId) return
    if (!confirm("Are you sure you want to delete this exam?")) return
    try {
      setDeleting(true)
      const response = await fetch(`/api/exams/${encodeURIComponent(examId)}`, {
        method: "DELETE",
      })
      const body = await response.json().catch(() => null)
      if (!response.ok || !body?.success) {
        throw new Error(body?.error || "Failed to delete exam")
      }
      router.push("/dashboard/exams")
      router.refresh()
    } catch (cause: any) {
      setError(cause.message || "Failed to delete exam")
    } finally {
      setDeleting(false)
    }
  }

  if (loading) {
    return (
      <div className="py-12 text-center">
        <p className="text-gray-500 dark:text-gray-400">Loading exam…</p>
      </div>
    )
  }

  if (error || !exam) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/exams">
          <Button variant="outline" size="icon" aria-label="Back to exams">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <p className="text-red-500">{error || "Exam not found"}</p>
      </div>
    )
  }

  const status = examStatusOf(exam)
  const questionCount = Array.isArray(exam.questions) ? exam.questions.length : 0
  const totalMarks = toFiniteNumber(exam.examMaxMarks) ?? 0
  const assigneeCount = toStringArray(exam.assignedUsers).length
  const shareUrl =
    typeof window !== "undefined" ? `${window.location.origin}/take-exam/${examId}` : `/take-exam/${examId}`

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/dashboard/exams">
          <Button variant="outline" size="icon" aria-label="Back to exams">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold">{exam.examTitle || "Untitled exam"}</h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant={status === "active" ? "default" : "secondary"}>{status}</Badge>
            <span className="text-sm text-gray-500 dark:text-gray-400">
              Created on {formatDate(exam.createdAt)}
            </span>
          </div>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Exam Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-1">
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Description</p>
              <p>{exam.examDescription || "No description provided."}</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                <div>
                  <p className="text-sm font-medium">Duration</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {exam.duration ?? 0} minutes
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                <div>
                  <p className="text-sm font-medium">Questions</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {questionCount} questions
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                <div>
                  <p className="text-sm font-medium">Total Marks</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{totalMarks} marks</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                <div>
                  <p className="text-sm font-medium">Passing Score</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {toFiniteNumber(exam.passingPercentage) ?? "—"}%
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                <div>
                  <p className="text-sm font-medium">Assigned</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {assigneeCount} {assigneeCount === 1 ? "user" : "users"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                <div>
                  <p className="text-sm font-medium">Scheduled</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {formatDate(exam.scheduledAt)}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex justify-end">
            {/* Previously two buttons with no onClick at all. */}
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete Exam"}
            </Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Overview</CardTitle>
            <CardDescription>Real values loaded from the exam record.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Questions</p>
                <p className="text-2xl font-bold">{questionCount}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Total Marks</p>
                <p className="text-2xl font-bold">{totalMarks}</p>
              </div>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Submission counts and score distribution are not exposed by the exam API, so they
              are not shown here.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Share Exam</CardTitle>
          <CardDescription>Share this exam with students</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <Input readOnly value={shareUrl} className="flex-1" />
            <Button
              variant="outline"
              size="icon"
              aria-label="Copy share link"
              onClick={() => navigator.clipboard?.writeText(shareUrl)}
            >
              <Link2 className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}