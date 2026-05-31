"use client"

import type React from "react"
import { use, useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/frontend/components/ui/card"
import { Button } from "@/frontend/components/ui/button"
import { Badge } from "@/frontend/components/ui/badge"
import { Separator } from "@/frontend/components/ui/separator"
import { Loader2, ArrowLeft, FileText, Calendar, BarChart3, BookOpen, Download, Share2 } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/frontend/components/ui/tabs"

interface Question {
  _id: string
  questionText: string
  subject: string
  topic?: string
  generateVia: "llm" | "ocr" | "user"
  bloomsLevel?: string
  ocrConfidence?: number
}

interface ReportData {
  _id: string
  examAnalysisId: string
  subjectName: string
  subjectCode?: string
  branch?: string
  year: string
  semester: string
  examType: "main" | "kt"
  questionIds: string[]
  totalQuestions: number
  totalMarks?: number
  bloomDistribution: {
    Recall: number
    Understand: number
    Apply: number
    Analyze: number
    Evaluate: number
    Create: number
  }
  overallAssessment?: string
  originalFileName: string
  originalFileUrl: string
  publishedBy: string
  publishedAt: string
  tags: string[]
  viewCount: number
  isPublic: boolean
  questions?: Question[]
}

export default function ReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params)
  const reportId = resolvedParams.id
  const router = useRouter()
  
  const [report, setReport] = useState<ReportData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchReport()
  }, [reportId])

  const fetchReport = async () => {
    try {
      setIsLoading(true)
      setError(null)
      const response = await fetch(`/api/reports/${reportId}`)
      
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Failed to fetch report")
      }
      
      const data = await response.json()
      setReport(data)
    } catch (err: any) {
      console.error("Error fetching report:", err)
      setError(err.message || "Failed to load report")
    } finally {
      setIsLoading(false)
    }
  }

  const getBloomColor = (level: string): string => {
    const colors: Record<string, string> = {
      Recall: "bg-blue-500",
      remember: "bg-blue-500",
      Understand: "bg-green-500",
      understand: "bg-green-500",
      Apply: "bg-yellow-500",
      apply: "bg-yellow-500",
      Analyze: "bg-orange-500",
      analyze: "bg-orange-500",
      Evaluate: "bg-red-500",
      evaluate: "bg-red-500",
      Create: "bg-purple-500",
      create: "bg-purple-500",
    }
    return colors[level] || "bg-gray-500"
  }

  const getBloomBadgeColor = (level?: string): string => {
    if (!level) return "secondary"
    const colors: Record<string, string> = {
      Recall: "default",
      remember: "default",
      Understand: "secondary",
      understand: "secondary",
      Apply: "outline",
      apply: "outline",
      Analyze: "destructive",
      analyze: "destructive",
      Evaluate: "destructive",
      evaluate: "destructive",
      Create: "default",
      create: "default",
    }
    return colors[level] || "secondary"
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-4">
          <Loader2 className="h-12 w-12 animate-spin mx-auto text-primary" />
          <p className="text-muted-foreground">Loading report...</p>
        </div>
      </div>
    )
  }

  if (error || !report) {
    return (
      <div className="mx-auto w-full max-w-4xl p-6">
        <Card>
          <CardHeader>
            <CardTitle>Error Loading Report</CardTitle>
            <CardDescription>{error || "Report not found"}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => router.back()}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Go Back
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-7xl p-6">
      {/* Header */}
      <div className="mb-6 space-y-4">
        <Button variant="outline" onClick={() => router.back()}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>

        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <h1 className="text-4xl font-bold tracking-tight">{report.subjectName}</h1>
            <p className="text-lg text-muted-foreground">{report.originalFileName}</p>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline">{report.year}</Badge>
              <Badge variant="outline">{report.semester}</Badge>
              <Badge variant={report.examType === "main" ? "default" : "secondary"}>
                {report.examType === "main" ? "Main Exam" : "KT Exam"}
              </Badge>
              {report.subjectCode && <Badge variant="secondary">{report.subjectCode}</Badge>}
              {report.branch && <Badge variant="secondary">{report.branch}</Badge>}
            </div>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" size="sm">
              <Share2 className="mr-2 h-4 w-4" />
              Share
            </Button>
            <Button variant="outline" size="sm">
              <Download className="mr-2 h-4 w-4" />
              Download
            </Button>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Questions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{report.totalQuestions}</div>
          </CardContent>
        </Card>

        {report.totalMarks && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Marks</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{report.totalMarks}</div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Views</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{report.viewCount}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Published</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm font-medium">
              {new Date(report.publishedAt).toLocaleDateString()}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="distribution">Bloom's Distribution</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4">
          {report.overallAssessment && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Overall Assessment
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground leading-relaxed">{report.overallAssessment}</p>
              </CardContent>
            </Card>
          )}

          {/* Questions Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold">Questions ({report.questions?.length || 0})</h2>
            </div>
            
            {report.questions && report.questions.length > 0 ? (
              report.questions.map((question, index) => (
                <Card key={question._id}>
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="space-y-1 flex-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">Q{index + 1}</Badge>
                          {question.bloomsLevel && (
                            <Badge variant={getBloomBadgeColor(question.bloomsLevel) as any}>
                              {question.bloomsLevel}
                            </Badge>
                          )}
                          {question.topic && (
                            <Badge variant="secondary" className="text-xs">
                              {question.topic}
                            </Badge>
                          )}
                        </div>
                        <CardDescription className="text-base text-foreground whitespace-pre-wrap">
                          {question.questionText}
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  {question.ocrConfidence && (
                    <CardContent>
                      <div className="text-xs text-muted-foreground">
                        OCR Confidence: {(question.ocrConfidence * 100).toFixed(1)}%
                      </div>
                    </CardContent>
                  )}
                </Card>
              ))
            ) : (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <BookOpen className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No questions available</p>
                </CardContent>
              </Card>
            )}
          </div>

          {report.tags && report.tags.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Tags</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {report.tags.map((tag, index) => (
                    <Badge key={index} variant="secondary">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Distribution Tab */}
        <TabsContent value="distribution">
          <Card>
            <CardHeader>
              <CardTitle>Detailed Bloom's Taxonomy Analysis</CardTitle>
              <CardDescription>
                Understanding cognitive complexity distribution
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {Object.entries(report.bloomDistribution).map(([level, percentage]) => (
                <div key={level} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <h3 className="font-semibold">{level}</h3>
                      <p className="text-sm text-muted-foreground">
                        {getBloomDescription(level)}
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold">{percentage.toFixed(1)}%</div>
                      <div className="text-xs text-muted-foreground">
                        {Math.round((percentage / 100) * report.totalQuestions)} questions
                      </div>
                    </div>
                  </div>
                  <div className="h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${getBloomColor(level)} transition-all`}
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                  <Separator />
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function getBloomDescription(level: string): string {
  const descriptions: Record<string, string> = {
    Recall: "Remember facts, terms, and basic concepts",
    Understand: "Explain ideas or concepts",
    Apply: "Use information in new situations",
    Analyze: "Draw connections and examine relationships",
    Evaluate: "Justify decisions and critique ideas",
    Create: "Produce new or original work",
  }
  return descriptions[level] || ""
}
