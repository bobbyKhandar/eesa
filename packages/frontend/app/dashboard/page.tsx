"use client"
import Link from "next/link"
import { useState, useEffect, use } from "react"
import { Button } from "@/frontend/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/frontend/components/ui/card"
import { BookOpen, FileText, BarChart3, Plus } from "lucide-react"
import { SignedOut, SignedIn, useUser } from "@clerk/nextjs"
import { SignInButton } from "@clerk/nextjs"
import { ArrowRight } from "lucide-react"

export default function DashboardPage() {
  const [submissions, setSubmissions] = useState<any[]>([])
  const [allocatedExams, setAllocatedExams] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [avgScore, setAvgScore] = useState<number | string>("loading..")
  const [recentExams, setRecentExams] = useState<any[]>([])
  const { user } = useUser()
  
  useEffect(() => {
    console.log('User effect triggered', user)
    if (!user?.id) return
    
    setLoading(true)
    setError(null)
    
    // First, create/ensure user exists
    fetch(`/api/users/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: user, role: "student" }),
    })
      .then(async (r) => {
        const resp = await r.json().catch(() => ({ success: false }))
        console.log('Create user response:', r.ok, resp)
        if (!r.ok || !resp?.success) throw new Error(resp?.error || "Failed to create user")

        const exams = Array.isArray(resp.user?.currentAllocatedExams) ? resp.user.currentAllocatedExams : []
        const subs = Array.isArray(resp.user?.submissionHistory) ? resp.user.submissionHistory : []
        
        console.log('Setting allocatedExams:', exams, 'submissions:', subs)
        setAllocatedExams(exams)
        const currentSubmissions = []
        for(const submission of subs){
          console.log(submission)
          try {
            const exam = await fetch(`api/users/submissions/${submission}/examDetails`)
            if (exam.ok) {
              const examData = await exam.json()
              // Keep the submission ID for linking to results page
              currentSubmissions.push({
                ...examData.examSet,
                submissionId: submission // Store the actual submission ID
              })
            }
          } catch (error) {
            console.error('Error fetching exam data:', error);
          }
        }
        setSubmissions(currentSubmissions)
      })
      .catch((e) => setError(e.message || String(e)))
      .finally(() => setLoading(false))
  }, [user?.id])
  
  // Derived metrics from submissions
  const [totalExams, setTotalExams] = useState(0)
  
  // Update totalExams whenever allocatedExams or submissions change
  useEffect(() => {
    setTotalExams(allocatedExams.length + submissions.length)
  }, [allocatedExams, submissions])


   useEffect(() => {
    const vals = submissions.map((s) => {

        if (s.totalMarks != null && s.marksAchieved != null) return (s.marksAchieved / s.totalMarks) * 100
        return undefined
      })
      .filter((v): v is number => typeof v === "number" && !Number.isNaN(v))
    
    if (vals.length === 0) {
      setAvgScore(0)
      return
    }
    
    const avgScore = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10
    setAvgScore(avgScore)
  }, [submissions])

  // Recent: newest first (just take first 6 from submissions - they're already fetched)
  useEffect(() => {
    if (submissions.length === 0) {
      setRecentExams([])
      return
    }
    
    // Take the 6 most recent submissions (already sorted)
    const recent = submissions.slice(0, 6)
    setRecentExams(recent)
  }, [submissions])

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
              <div className="text-2xl font-bold">{submissions.length}</div>
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
          {recentExams.length === 0 && !loading && !error && (
            <Card>
              <CardHeader>
                <CardTitle>No recent submissions</CardTitle>
                <CardDescription>Complete an exam to see it here</CardDescription>
              </CardHeader>
            </Card>
          )}

          {recentExams.map((s,i) => {
            console.log(s)
            const date = new Date(s.submittedAt || 0)
            const dateStr = date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
            const status = s.evaluatedAt ? "Completed" : "Submitted"
            const score = s.marksAchieved && s.totalMarks ? `${((s.marksAchieved / s.totalMarks) * 100).toFixed(2)}%` : "N/A"
            
            const examSet = s.title 
            return (
              <Card key={""+s.examId+" "+i}>
                <CardHeader>  
                  <CardTitle>{examSet}</CardTitle>
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
                  <Link href={`/results/${s.submissionId}`} className="w-full">
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
