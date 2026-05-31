"use client"
import Link from "next/link"
import { use, useState, useEffect } from "react"
import { useUser } from "@clerk/nextjs"
import { Button } from "@/frontend/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/frontend/components/ui/card"
import { Badge } from "@/frontend/components/ui/badge"
import { Progress } from "@/frontend/components/ui/progress"
import { ArrowLeft, CheckCircle, XCircle, AlertCircle } from "lucide-react"

export default function ResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = useUser()
  const resolvedParams = use(params)
  const [result, setResult] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchSubmission = async () => {
      try {
        setLoading(true)
        const response = await fetch(`/api/submissions/${resolvedParams.id}`)
        const data = await response.json()
        
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Failed to fetch submission")
        }
        
        setResult(data.data)
      } catch (err: any) {
        setError(err.message || "Failed to load results")
      } finally {
        setLoading(false)
      }
    }

    fetchSubmission()
  }, [resolvedParams.id])

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8 px-4">
        <div className="max-w-4xl mx-auto">
          <p className="text-center text-gray-500 dark:text-gray-400">Loading results...</p>
        </div>
      </div>
    )
  }

  if (error || !result) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8 px-4">
        <div className="max-w-4xl mx-auto">
          <p className="text-center text-red-500">{error || "Results not found"}</p>
          <div className="flex justify-center mt-4">
            <Link href="/dashboard">
              <Button>Return to Dashboard</Button>
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const totalScore = result.marksAchieved
  const totalMaxScore = result.maxMarks
  const scorePercentage = (totalScore / totalMaxScore) * 100
  const passingScore = 60
  const status = scorePercentage >= passingScore ? "Passed" : "Failed"
  const submittedDate = new Date(result.submittedAt).toLocaleString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8 px-4">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <Link href="/dashboard">
            <Button variant="outline" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Exam Results</h1>
            <p className="text-gray-500 dark:text-gray-400">{result.examTitle}</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>{user?.fullName || user?.username || "Student"}</CardTitle>
                <CardDescription>
                  Submitted: {submittedDate}
                  {result.autoSubmitted && " (Auto-submitted)"}
                </CardDescription>
              </div>
              <Badge variant={status === "Passed" ? "default" : "destructive"}>{status}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Score</p>
                <p className="text-3xl font-bold">
                  {totalScore}/{totalMaxScore} ({Math.round(scorePercentage)}%)
                </p>
              </div>
              <div className="text-sm text-gray-500 dark:text-gray-400">
                Passing Score: {passingScore}%
                {result.timeSpent && (
                  <span className="ml-4">
                    Time Spent: {Math.floor(result.timeSpent / 60)}m {result.timeSpent % 60}s
                  </span>
                )}
              </div>
            </div>

            <Progress value={scorePercentage} className="h-2" />

            {result.evaluatorObservations && (
              <div className="pt-2">
                <p className="text-sm font-medium mb-1">Evaluator Observations:</p>
                <p className="text-sm bg-yellow-50 dark:bg-yellow-950 p-3 rounded-md border-l-4 border-yellow-500">
                  {result.evaluatorObservations}
                </p>
              </div>
            )}

            <div className="pt-4">
              <h3 className="text-lg font-medium mb-4">Question-by-Question Review</h3>

              {result.questions.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">No questions found for this exam.</p>
              ) : (
                result.questions.map((question: any, index: number) => {
                  const response = question.userResponse
                  const score = response?.allottedMarks || 0
                  const maxScore = question.maxScore || 10

                  return (
                    <Card key={question.id} className="mb-4 border border-gray-200 dark:border-gray-800">
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-base">Question {index + 1}</CardTitle>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">
                              {score}/{maxScore}
                            </span>
                            {score === maxScore ? (
                              <CheckCircle className="h-4 w-4 text-green-500" />
                            ) : score === 0 ? (
                              <XCircle className="h-4 w-4 text-red-500" />
                            ) : (
                              <AlertCircle className="h-4 w-4 text-amber-500" />
                            )}
                          </div>
                        </div>
                        <CardDescription className="mt-1">{question.text}</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {question.type === "mcq" && question.options && question.options.length > 0 && (
                          <div>
                            <p className="text-sm font-medium mb-2">Options:</p>
                            <ul className="list-disc list-inside text-sm space-y-1">
                              {question.options.map((option: string, i: number) => (
                                <li
                                  key={i}
                                  className={
                                    response?.userResponse === option
                                      ? option === question.correctAnswer
                                        ? "text-green-600 font-medium"
                                        : "text-red-600 font-medium"
                                      : option === question.correctAnswer
                                      ? "text-green-600"
                                      : ""
                                  }
                                >
                                  {option}
                                  {option === question.correctAnswer && " ✓ (Correct)"}
                                  {response?.userResponse === option && option !== question.correctAnswer && " ✗ (Your answer)"}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        <div>
                          <p className="text-sm font-medium mb-1">Your Answer:</p>
                          <p className="text-sm bg-gray-100 dark:bg-gray-800 p-3 rounded-md whitespace-pre-wrap">
                            {response?.userResponse || "No answer provided"}
                          </p>
                        </div>

                        {response?.feedback && (
                          <div>
                            <p className="text-sm font-medium mb-1">AI Feedback:</p>
                            <p className="text-sm bg-blue-50 dark:bg-blue-950 p-3 rounded-md border-l-4 border-blue-500">
                              {response.feedback}
                            </p>
                          </div>
                        )}

                        {response?.suggestions && response.suggestions.length > 0 && (
                          <div>
                            <p className="text-sm font-medium mb-1">Suggestions for Improvement:</p>
                            <ul className="list-disc list-inside text-sm bg-green-50 dark:bg-green-950 p-3 rounded-md space-y-1">
                              {response.suggestions.map((suggestion: string, i: number) => (
                                <li key={i}>{suggestion}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )
                })
              )}
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-center gap-4">
          <Button variant="outline" onClick={() => window.print()}>Download Results</Button>
          <Link href="/dashboard">
            <Button>Return to Dashboard</Button>
          </Link>
        </div>
      </div>
    </div>
  )
}
