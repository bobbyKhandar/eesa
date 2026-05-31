"use client"

import { use, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/frontend/components/ui/card"
import { Button } from "@/frontend/components/ui/button"
import { Badge } from "@/frontend/components/ui/badge"
import { Loader2, AlertCircle } from "lucide-react"
import DistributionChart from "@/frontend/components/analysis/distribution-chart"

export default function AnalysisReportPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter()
  const { id } = use(params)
  const [analysis, setAnalysis] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchAnalysis()
    // Poll for updates if status is pending or processing
    const interval = setInterval(() => {
      if (analysis?.status === "pending" || analysis?.status === "processing") {
        fetchAnalysis()
      }
    }, 3000) // Poll every 3 seconds

    return () => clearInterval(interval)
  }, [id, analysis?.status])

  async function fetchAnalysis() {
    try {
      const response = await fetch(`/api/exam-analysis/${id}`)
      const data = await response.json()

      if (!data.success) {
        setError(data.error || "Failed to load analysis")
        setLoading(false)
        return
      }

      setAnalysis(data.analysis)
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load analysis")
      setLoading(false)
    }
  }

  async function handleDelete() {
    if (!confirm("Are you sure you want to delete this analysis?")) {
      return
    }

    try {
      const response = await fetch(`/api/exam-analysis/${id}`, {
        method: "DELETE",
      })

      if (!response.ok) {
        throw new Error("Failed to delete analysis")
      }

      router.push("/ai-analyze")
    } catch (err: any) {
      alert(err.message || "Failed to delete analysis")
    }
  }

  async function handlePublish() {
    // TODO: Implement publish functionality
    alert("Publish functionality coming soon!")
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground">Loading analysis...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 mx-auto mb-4 text-destructive" />
          <h2 className="text-xl font-semibold mb-2">Error Loading Analysis</h2>
          <p className="text-muted-foreground">{error}</p>
          <Button onClick={() => router.push("/ai-analyze")} className="mt-4">
            Go Back
          </Button>
        </div>
      </div>
    )
  }

  if (!analysis) {
    return null
  }

  // Show processing status
  if (analysis.status === "pending" || analysis.status === "processing") {
    return (
      <div className="mx-auto w-full max-w-7xl">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              Processing Your Exam
            </CardTitle>
            <CardDescription>
              Subject: {analysis.subjectName} • {analysis.semester} • {analysis.year}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <p className="text-sm">
                {analysis.status === "pending" 
                  ? "Your exam is in the queue for processing..." 
                  : "AI is analyzing your exam paper..."}
              </p>
              <div className="grid gap-2 text-sm">
                <div className="flex items-center gap-2">
                  <div className={`h-2 w-2 rounded-full ${analysis.extractedText ? 'bg-green-500' : 'bg-yellow-500 animate-pulse'}`} />
                  <span>OCR Text Extraction</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className={`h-2 w-2 rounded-full ${analysis.totalQuestions > 0 ? 'bg-green-500' : 'bg-gray-300'}`} />
                  <span>Question Extraction & Refinement</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className={`h-2 w-2 rounded-full ${analysis.questions?.length > 0 ? 'bg-green-500' : 'bg-gray-300'}`} />
                  <span>Bloom's Taxonomy Classification</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className={`h-2 w-2 rounded-full bg-gray-300`} />
                  <span>Generating Insights</span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-4">
                This page will automatically update when processing is complete.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Show error status
  if (analysis.status === "failed") {
    return (
      <div className="mx-auto w-full max-w-7xl">
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="text-destructive">Analysis Failed</CardTitle>
            <CardDescription>
              Subject: {analysis.subjectName} • {analysis.semester} • {analysis.year}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm mb-4">
              Unfortunately, the analysis failed to complete. Please try uploading the exam again.
            </p>
            <p className="text-xs text-muted-foreground">Error: {analysis.processingError}</p>
            <div className="flex gap-2 mt-4">
              <Button variant="destructive" onClick={handleDelete}>
                Delete
              </Button>
              <Button variant="outline" onClick={() => router.push("/ai-analyze")}>
                Try Again
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Transform data for chart
  const chartData = [
    { name: "Recall", value: analysis.bloomDistribution.Recall, color: "#0ea5e9" },
    { name: "Understand", value: analysis.bloomDistribution.Understand, color: "#22c55e" },
    { name: "Apply", value: analysis.bloomDistribution.Apply, color: "#f59e0b" },
    { name: "Analyze", value: analysis.bloomDistribution.Analyze, color: "#a855f7" },
    { name: "Evaluate", value: analysis.bloomDistribution.Evaluate, color: "#ef4444" },
    { name: "Create", value: analysis.bloomDistribution.Create, color: "#6b7280" },
  ]

  const getBloomLevelColor = (level: string) => {
    switch (level) {
      case "Recall":
        return "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300"
      case "Understand":
        return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"
      case "Apply":
        return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
      case "Analyze":
        return "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300"
      case "Evaluate":
        return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
      case "Create":
        return "bg-slate-100 text-slate-800 dark:bg-slate-900/30 dark:text-slate-300"
      default:
        return "bg-gray-100 text-gray-800"
    }
  }

  return (
    <div className="mx-auto w-full max-w-7xl">
      {/* Header with actions */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">Analysis Report</h1>
          <p className="text-sm text-muted-foreground">
            Subject: <span className="font-medium text-foreground">{analysis.subjectName}</span> •{" "}
            {analysis.semester} • {analysis.year}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="destructive" onClick={handleDelete}>Delete</Button>
          <Button onClick={handlePublish}>Publish</Button>
        </div>
      </div>

      {/* Top grid: chart + insight cards */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Question Distribution by Classification Level</CardTitle>
            <CardDescription>Percentage of questions across Bloom&apos;s taxonomy levels</CardDescription>
          </CardHeader>
          <CardContent>
            <DistributionChart data={chartData} />
          </CardContent>
        </Card>

        <div className="grid gap-4">
          {/* Syllabus Coverage Insight */}
          {analysis.syllabusCoverage && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{analysis.syllabusCoverage.title || "Syllabus Coverage"}</CardTitle>
                <CardDescription>Alignment with course syllabus</CardDescription>
              </CardHeader>
              <CardContent className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">{analysis.syllabusCoverage.status}</p>
                  <p className="text-sm text-muted-foreground">{analysis.syllabusCoverage.detail}</p>
                </div>
                <Badge variant="secondary" className="shrink-0">
                  {analysis.syllabusCoverage.coveragePercentage}%
                </Badge>
              </CardContent>
            </Card>
          )}

          {/* Past Paper Comparison Insight */}
          {analysis.pastPaperComparison && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Past-Paper Comparison</CardTitle>
                <CardDescription>Comparison with historical patterns</CardDescription>
              </CardHeader>
              <CardContent className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">{analysis.pastPaperComparison.status}</p>
                  <p className="text-sm text-muted-foreground">{analysis.pastPaperComparison.detail}</p>
                </div>
                <Badge variant="outline" className="shrink-0">
                  {analysis.pastPaperComparison.tone === "neutral" ? "Aligned" : "Check"}
                </Badge>
              </CardContent>
            </Card>
          )}

          {/* Overall Assessment */}
          {!analysis.syllabusCoverage && !analysis.pastPaperComparison && analysis.overallAssessment && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Overall Assessment</CardTitle>
                <CardDescription>AI-generated summary</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm">{analysis.overallAssessment}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Recommendations, Strengths, Improvements */}
      {(analysis.recommendations?.length > 0 || analysis.strengths?.length > 0 || analysis.improvements?.length > 0) && (
        <div className="grid gap-4 md:grid-cols-3 mt-4">
          {analysis.recommendations?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recommendations</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="text-sm space-y-2 list-disc list-inside">
                  {analysis.recommendations.map((rec: string, idx: number) => (
                    <li key={idx}>{rec}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {analysis.strengths?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Strengths</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="text-sm space-y-2 list-disc list-inside text-green-600 dark:text-green-400">
                  {analysis.strengths.map((strength: string, idx: number) => (
                    <li key={idx}>{strength}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {analysis.improvements?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Areas for Improvement</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="text-sm space-y-2 list-disc list-inside text-amber-600 dark:text-amber-400">
                  {analysis.improvements.map((improvement: string, idx: number) => (
                    <li key={idx}>{improvement}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Detailed Results Table */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Detailed Results</CardTitle>
          <CardDescription>
            Question-by-question breakdown with classification and AI justification
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full table-auto border-separate border-spacing-0">
            <thead>
              <tr className="[&>th]:bg-muted/50">
                <th
                  scope="col"
                  className="sticky left-0 z-10 border-b px-4 py-3 text-left text-xs font-medium uppercase tracking-wide"
                >
                  Question
                </th>
                <th scope="col" className="border-b px-4 py-3 text-left text-xs font-medium uppercase tracking-wide">
                  Marks
                </th>
                <th scope="col" className="border-b px-4 py-3 text-left text-xs font-medium uppercase tracking-wide">
                  Classification
                </th>
                <th scope="col" className="border-b px-4 py-3 text-left text-xs font-medium uppercase tracking-wide">
                  AI Justification
                </th>
              </tr>
            </thead>
            <tbody>
              {analysis.questions && analysis.questions.map((q: any, idx: number) => (
                <tr key={idx} className="even:bg-muted/30">
                  <td className="sticky left-0 z-0 max-w-[520px] whitespace-pre-wrap px-4 py-3 align-top">
                    <p className="text-sm font-medium text-foreground mb-1">{q.questionNumber}</p>
                    <p className="text-sm text-foreground">{q.questionText}</p>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <span className="text-sm font-medium">{q.marks}</span>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${getBloomLevelColor(q.bloomLevel)}`}>
                      {q.bloomLevel}
                    </span>
                    {q.confidence && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Confidence: {(q.confidence * 100).toFixed(0)}%
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <p className="text-sm text-muted-foreground">{q.bloomJustification}</p>
                    {q.keywords && q.keywords.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {q.keywords.map((keyword: string, kidx: number) => (
                          <Badge key={kidx} variant="outline" className="text-xs">
                            {keyword}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
