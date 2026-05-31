"use client"

import type React from "react"
import { use, useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/frontend/components/ui/card"
import { Button } from "@/frontend/components/ui/button"
import { Badge } from "@/frontend/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/frontend/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/frontend/components/ui/tabs"
import { Input } from "@/frontend/components/ui/input"
import { Loader2, ArrowLeft, FileText, Calendar, BarChart3, Eye, BookOpen, Sparkles, Search } from "lucide-react"

interface AnalysisReport {
  _id: string
  subjectName: string
  subjectCode?: string
  branch?: string
  year: string
  semester: string
  examType: "main" | "kt"
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
  publishedAt: string
  viewCount: number
}

interface UniqueQuestion {
  _id: string
  questionText: string
  normalizedText: string
  subject: string
  topics: string[]
  bloomsLevel?: string
  occurrenceCount: number
  firstSeenAt: string
  lastSeenAt: string
  appearances: Array<{
    year: string
    semester: string
    examType: "main" | "kt"
    analysisReportId: string
  }>
  tags: string[]
}

interface UniqueQuestionStats {
  totalUniqueQuestions: number
  totalOccurrences: number
  avgOccurrence: number
  bloomsDistribution: Record<string, number>
}

export default function SubjectReportsPage({ params }: { params: Promise<{ subjectName: string }> }) {
  const resolvedParams = use(params)
  const subjectName = decodeURIComponent(resolvedParams.subjectName)
  const router = useRouter()
  
  const [reports, setReports] = useState<AnalysisReport[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [filterYear, setFilterYear] = useState<string>("all")
  const [filterSemester, setFilterSemester] = useState<string>("all")
  const [filterExamType, setFilterExamType] = useState<string>("all")
  
  // Unique questions state
  const [uniqueQuestions, setUniqueQuestions] = useState<UniqueQuestion[]>([])
  const [uniqueStats, setUniqueStats] = useState<UniqueQuestionStats | null>(null)
  const [isLoadingUnique, setIsLoadingUnique] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [bloomFilter, setBloomFilter] = useState<string>("all")

  useEffect(() => {
    fetchReports()
  }, [filterYear, filterSemester, filterExamType])

  useEffect(() => {
    fetchUniqueQuestions()
    fetchUniqueStats()
  }, [bloomFilter])

  const fetchReports = async () => {
    try {
      setIsLoading(true)
      const params = new URLSearchParams({ subjectName })
      if (filterYear !== "all") params.append("year", filterYear)
      if (filterSemester !== "all") params.append("semester", filterSemester)
      if (filterExamType !== "all") params.append("examType", filterExamType)
      
      const response = await fetch(`/api/subjects?${params.toString()}`)
      const data = await response.json()
      setReports(data.reports || [])
    } catch (error) {
      console.error("Error fetching reports:", error)
      setReports([])
    } finally {
      setIsLoading(false)
    }
  }

  const fetchUniqueQuestions = async () => {
    try {
      setIsLoadingUnique(true)
      const params = new URLSearchParams({ subject: subjectName })
      if (bloomFilter !== "all") params.append("bloomsLevel", bloomFilter)
      if (searchQuery) params.append("search", searchQuery)
      params.append("sortBy", "occurrenceCount")
      params.append("sortOrder", "desc")
      
      const response = await fetch(`/api/unique-questions?${params.toString()}`)
      const data = await response.json()
      setUniqueQuestions(data)
    } catch (error) {
      console.error("Error fetching unique questions:", error)
      setUniqueQuestions([])
    } finally {
      setIsLoadingUnique(false)
    }
  }

  const fetchUniqueStats = async () => {
    try {
      const params = new URLSearchParams({ 
        subject: subjectName,
        action: "stats"
      })
      const response = await fetch(`/api/unique-questions?${params.toString()}`)
      const data = await response.json()
      setUniqueStats(data)
    } catch (error) {
      console.error("Error fetching stats:", error)
    }
  }

  const handleSearch = () => {
    fetchUniqueQuestions()
  }

  const getBloomColor = (level: string, percentage: number): string => {
    if (percentage === 0) return "bg-gray-100"
    const colors: Record<string, string> = {
      Recall: "bg-blue-500",
      Understand: "bg-green-500",
      Apply: "bg-yellow-500",
      Analyze: "bg-orange-500",
      Evaluate: "bg-red-500",
      Create: "bg-purple-500",
    }
    return colors[level] || "bg-gray-500"
  }

  const uniqueYears = Array.from(new Set(reports.map(r => r.year))).sort().reverse()
  const uniqueSemesters = Array.from(new Set(reports.map(r => r.semester))).sort()

  const getBloomBadgeColor = (level?: string): string => {
    if (!level) return "secondary"
    const colors: Record<string, string> = {
      remember: "default",
      understand: "secondary",
      apply: "outline",
      analyze: "destructive",
      evaluate: "destructive",
      create: "default",
    }
    return colors[level.toLowerCase()] || "secondary"
  }

  return (
    <div className="mx-auto w-full max-w-7xl p-6">
      <div className="mb-6 space-y-4">
        <Button variant="outline" onClick={() => router.push("/subjects-question-bank")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Subjects
        </Button>

        <div>
          <h1 className="text-4xl font-bold tracking-tight mb-2">{subjectName}</h1>
          <p className="text-muted-foreground">
            Browse and analyze previous year question papers and unique questions for this subject
          </p>
        </div>
      </div>

      {/* Tabs for Reports and Unique Questions */}
      <Tabs defaultValue="reports" className="space-y-4">
        <TabsList>
          <TabsTrigger value="reports">
            <FileText className="mr-2 h-4 w-4" />
            Reports ({reports.length})
          </TabsTrigger>
          <TabsTrigger value="unique">
            <Sparkles className="mr-2 h-4 w-4" />
            Unique Questions ({uniqueStats?.totalUniqueQuestions || 0})
          </TabsTrigger>
        </TabsList>

        {/* Reports Tab */}
        <TabsContent value="reports" className="space-y-4">
          {/* Filters */}
          <div className="flex gap-4 items-center">
          <Select value={filterYear} onValueChange={setFilterYear}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter by year" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Years</SelectItem>
              {uniqueYears.map(year => (
                <SelectItem key={year} value={year}>{year}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filterSemester} onValueChange={setFilterSemester}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter by semester" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Semesters</SelectItem>
              {uniqueSemesters.map(sem => (
                <SelectItem key={sem} value={sem}>{sem}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filterExamType} onValueChange={setFilterExamType}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter by type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="main">Main Exam</SelectItem>
              <SelectItem value="kt">KT Exam</SelectItem>
            </SelectContent>
          </Select>

          {(filterYear !== "all" || filterSemester !== "all" || filterExamType !== "all") && (
            <Button
              variant="ghost"
              onClick={() => {
                setFilterYear("all")
                setFilterSemester("all")
                setFilterExamType("all")
              }}
            >
              Clear Filters
            </Button>
          )}
        </div>

          {/* Reports List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : reports.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileText className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium text-muted-foreground">
              No reports found
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              Try adjusting your filters or check back later
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {reports.map((report) => (
            <Card key={report._id} className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="space-y-1 flex-1">
                    <CardTitle className="text-xl">{report.originalFileName}</CardTitle>
                    <CardDescription className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline">{report.year}</Badge>
                      <Badge variant="outline">{report.semester}</Badge>
                      <Badge variant={report.examType === "main" ? "default" : "secondary"}>
                        {report.examType === "main" ? "Main Exam" : "KT Exam"}
                      </Badge>
                      {report.branch && <Badge variant="secondary">{report.branch}</Badge>}
                    </CardDescription>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => router.push(`/reports/${report._id}`)}
                  >
                    <Eye className="mr-2 h-4 w-4" />
                    View Details
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Questions</p>
                    <p className="font-semibold text-lg">{report.totalQuestions}</p>
                  </div>
                  {report.totalMarks && (
                    <div>
                      <p className="text-muted-foreground">Total Marks</p>
                      <p className="font-semibold text-lg">{report.totalMarks}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-muted-foreground">Views</p>
                    <p className="font-semibold text-lg">{report.viewCount}</p>
                  </div>
                </div>

                {report.overallAssessment && (
                  <div className="p-3 bg-muted rounded-lg">
                    <p className="text-sm">{report.overallAssessment}</p>
                  </div>
                )}

                {/* Bloom's Distribution Visualization */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <BarChart3 className="h-4 w-4 text-muted-foreground" />
                    <p className="text-sm font-medium">Bloom's Taxonomy Distribution</p>
                  </div>
                  <div className="space-y-2">
                    {Object.entries(report.bloomDistribution).map(([level, percentage]) => (
                      <div key={level} className="flex items-center gap-3">
                        <span className="text-xs w-24 text-muted-foreground font-medium">{level}</span>
                        <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${getBloomColor(level, percentage)} transition-all`}
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                        <span className="text-xs w-14 text-right text-muted-foreground font-mono">
                          {percentage.toFixed(1)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
        </TabsContent>

        {/* Unique Questions Tab */}
        <TabsContent value="unique" className="space-y-4">
          {/* Stats Cards */}
          {uniqueStats && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Unique Questions</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{uniqueStats.totalUniqueQuestions}</div>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Total Occurrences</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{uniqueStats.totalOccurrences}</div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Avg. Repetitions</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{uniqueStats.avgOccurrence.toFixed(1)}</div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Search and Filters */}
          <div className="flex gap-4 items-center">
            <div className="flex-1 flex gap-2">
              <Input
                placeholder="Search questions..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              />
              <Button onClick={handleSearch}>
                <Search className="h-4 w-4" />
              </Button>
            </div>

            <Select value={bloomFilter} onValueChange={setBloomFilter}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Filter by Bloom's Level" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Levels</SelectItem>
                <SelectItem value="remember">Remember</SelectItem>
                <SelectItem value="understand">Understand</SelectItem>
                <SelectItem value="apply">Apply</SelectItem>
                <SelectItem value="analyze">Analyze</SelectItem>
                <SelectItem value="evaluate">Evaluate</SelectItem>
                <SelectItem value="create">Create</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Questions List */}
          {isLoadingUnique ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : uniqueQuestions.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <BookOpen className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-lg font-medium text-muted-foreground">
                  No unique questions found
                </p>
                <p className="text-sm text-muted-foreground mt-2">
                  Questions will appear here after publishing exam analyses
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {uniqueQuestions.map((question, index) => (
                <Card key={question._id} className="hover:shadow-md transition-shadow">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-2 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline">Q{index + 1}</Badge>
                          {question.bloomsLevel && (
                            <Badge variant={getBloomBadgeColor(question.bloomsLevel) as any}>
                              {question.bloomsLevel}
                            </Badge>
                          )}
                          <Badge variant="secondary">
                            Appeared {question.occurrenceCount} time{question.occurrenceCount > 1 ? "s" : ""}
                          </Badge>
                        </div>
                        <CardDescription className="text-base text-foreground whitespace-pre-wrap">
                          {question.questionText}
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {question.topics.length > 0 && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm text-muted-foreground">Topics:</span>
                        {question.topics.map((topic, i) => (
                          <Badge key={i} variant="outline" className="text-xs">
                            {topic}
                          </Badge>
                        ))}
                      </div>
                    )}

                    {question.appearances.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-sm font-medium text-muted-foreground">Appeared in:</p>
                        <div className="flex flex-wrap gap-2">
                          {question.appearances.map((app, i) => (
                            <Badge key={i} variant="secondary" className="text-xs">
                              {app.year} - {app.semester} ({app.examType === "main" ? "Main" : "KT"})
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t">
                      <span>First seen: {new Date(question.firstSeenAt).toLocaleDateString()}</span>
                      <span>Last seen: {new Date(question.lastSeenAt).toLocaleDateString()}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
