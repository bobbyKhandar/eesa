"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { useUser } from "@clerk/nextjs"
import { Button } from "@/frontend/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/frontend/components/ui/card"
import { Input } from "@/frontend/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/frontend/components/ui/select"
import { Badge } from "@/frontend/components/ui/badge"
import { Progress } from "@/frontend/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/frontend/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/frontend/components/ui/table"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
} from "recharts"
import {
  Award,
  TrendingUp,
  Target,
  Search,
  Filter,
  Download,
  Eye,
  Share2,
  BarChart3,
  PieChartIcon,
  LineChartIcon,
  CheckCircle,
  XCircle,
  AlertCircle,
  Loader2,
} from "lucide-react"

interface ExamResult {
  id: string
  examName: string
  subject: string
  date: string
  score: number
  totalMarks: number
  percentage: number
  grade: string
  status: "passed" | "failed"
  duration: string
  autoSubmitted?: boolean
  responsesCount?: number
}

interface ResultsData {
  results: ExamResult[]
  stats: {
    totalExams: number
    passedExams: number
    avgScore: number
    highestScore: number
    passRate: number
  }
  performanceData: { month: string; score: number }[]
  subjectPerformance: { subject: string; score: number; color: string }[]
  gradeDistribution: { grade: string; count: number; color: string }[]
}

export default function ResultsPage() {
  const { isLoaded, isSignedIn } = useUser()
  const [searchQuery, setSearchQuery] = useState("")
  const [subjectFilter, setSubjectFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")
  const [dateFilter, setDateFilter] = useState("all")
  const [activeTab, setActiveTab] = useState("overview")
  
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<ResultsData | null>(null)

  useEffect(() => {
    if (!isLoaded || !isSignedIn) {
      setLoading(false)
      return
    }
    
    const fetchResults = async () => {
      try {
        setLoading(true)
        setError(null)
        
        const response = await fetch("/api/results")
        const json = await response.json()
        
        if (!response.ok || !json.success) {
          throw new Error(json.error || "Failed to fetch results")
        }
        
        setData(json.data)
      } catch (err: any) {
        setError(err.message || "Failed to load results")
      } finally {
        setLoading(false)
      }
    }
    
    fetchResults()
  }, [isLoaded, isSignedIn])

  // Get unique subjects for filter
  const subjects = data?.results
    ? [...new Set(data.results.map(r => r.subject))]
    : []

  // Filter results from API data
  const filteredResults = (data?.results || []).filter((result) => {
    const matchesSearch =
      result.examName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      result.subject.toLowerCase().includes(searchQuery.toLowerCase())

    const matchesSubject = subjectFilter === "all" || result.subject === subjectFilter
    const matchesStatus = statusFilter === "all" || result.status === statusFilter

    let matchesDate = true
    if (dateFilter !== "all") {
      const resultDate = new Date(result.date)
      const now = new Date()
      const diffTime = Math.abs(now.getTime() - resultDate.getTime())
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

      switch (dateFilter) {
        case "week":
          matchesDate = diffDays <= 7
          break
        case "month":
          matchesDate = diffDays <= 30
          break
        case "semester":
          matchesDate = diffDays <= 120
          break
      }
    }

    return matchesSearch && matchesSubject && matchesStatus && matchesDate
  })

  const getGradeColor = (grade: string) => {
    switch (grade) {
      case "A+":
        return "bg-green-500"
      case "A":
        return "bg-blue-500"
      case "B+":
        return "bg-cyan-500"
      case "B":
        return "bg-yellow-500"
      case "C+":
        return "bg-orange-500"
      case "C":
        return "bg-red-500"
      default:
        return "bg-gray-500"
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "passed":
        return <CheckCircle className="h-4 w-4 text-green-500" />
      case "failed":
        return <XCircle className="h-4 w-4 text-red-500" />
      default:
        return <AlertCircle className="h-4 w-4 text-yellow-500" />
    }
  }

  // Show loading state
  if (!isLoaded || loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-gray-500" />
        <span className="ml-2 text-gray-500">Loading results...</span>
      </div>
    )
  }

  // Show sign-in prompt
  if (!isSignedIn) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center">
        <Award className="h-16 w-16 text-gray-300 mb-4" />
        <h2 className="text-2xl font-bold mb-2">Sign In Required</h2>
        <p className="text-gray-500 mb-4">Please sign in to view your exam results.</p>
        <Link href="/sign-in">
          <Button>Sign In</Button>
        </Link>
      </div>
    )
  }

  // Show error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center">
        <AlertCircle className="h-16 w-16 text-red-300 mb-4" />
        <h2 className="text-2xl font-bold mb-2">Error Loading Results</h2>
        <p className="text-gray-500 mb-4">{error}</p>
        <Button onClick={() => window.location.reload()}>Try Again</Button>
      </div>
    )
  }

  // Show empty state
  if (!data?.results.length) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center">
        <Award className="h-16 w-16 text-gray-300 mb-4" />
        <h2 className="text-2xl font-bold mb-2">No Results Yet</h2>
        <p className="text-gray-500 mb-4">You haven&apos;t completed any exams yet. Take an exam to see your results here.</p>
        <Link href="/dashboard">
          <Button>Go to Dashboard</Button>
        </Link>
      </div>
    )
  }

  // Get stats and chart data from API response
  const { stats, performanceData, subjectPerformance, gradeDistribution } = data

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Exam Results</h1>
          <p className="text-gray-500 dark:text-gray-400">Track your academic performance and progress</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1 bg-transparent">
            <Download className="h-4 w-4" />
            Export Results
          </Button>
          <Button variant="outline" size="sm" className="gap-1 bg-transparent">
            <Share2 className="h-4 w-4" />
            Share
          </Button>
        </div>
      </div>

      {/* Statistics Cards */}
      <div className="grid gap-6 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Average Score</CardTitle>
            <Target className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.avgScore}%</div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              <TrendingUp className="inline h-3 w-3 mr-1" />
              Across all exams
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Exams</CardTitle>
            <Award className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalExams}</div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Completed exams</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Pass Rate</CardTitle>
            <CheckCircle className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.passRate}%</div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {stats.passedExams}/{stats.totalExams} exams passed
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Highest Score</CardTitle>
            <TrendingUp className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.highestScore}%</div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Best performance</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="overview" onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-4 w-full">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="detailed">Detailed Results</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="comparison">Comparison</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="mt-6 space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Performance Trend */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <LineChartIcon className="h-5 w-5" />
                  Performance Trend
                </CardTitle>
                <CardDescription>Your score progression over time</CardDescription>
              </CardHeader>
              <CardContent>
                {performanceData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={performanceData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis />
                    <Tooltip />
                    <Line type="monotone" dataKey="score" stroke="#8884d8" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-[300px] text-gray-500">
                    Not enough data for trend analysis
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Grade Distribution */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <PieChartIcon className="h-5 w-5" />
                  Grade Distribution
                </CardTitle>
                <CardDescription>Distribution of your grades</CardDescription>
              </CardHeader>
              <CardContent>
                {gradeDistribution.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={gradeDistribution}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ grade, count }) => `${grade} (${count})`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="count"
                    >
                      {gradeDistribution.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-[300px] text-gray-500">
                    No grade data available
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Recent Results */}
          <Card>
            <CardHeader>
              <CardTitle>Recent Results</CardTitle>
              <CardDescription>Your latest exam performances</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {data.results.slice(0, 3).map((result) => (
                  <div key={result.id} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex items-center gap-4">
                      {getStatusIcon(result.status)}
                      <div>
                        <div className="font-medium">{result.examName}</div>
                        <div className="text-sm text-gray-500 dark:text-gray-400">
                          {result.subject} • {new Date(result.date).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <div className="font-bold">{result.percentage}%</div>
                        <div className="text-sm text-gray-500 dark:text-gray-400">
                          {result.score}/{result.totalMarks}
                        </div>
                      </div>
                      <Badge className={getGradeColor(result.grade)}>{result.grade}</Badge>
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/results/${result.id}`}>
                          <Eye className="h-4 w-4" />
                        </Link>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Detailed Results Tab */}
        <TabsContent value="detailed" className="mt-6 space-y-6">
          {/* Search and Filter */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Filter className="h-5 w-5" />
                Filter Results
              </CardTitle>
              <CardDescription>Search and filter your exam results</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-500 dark:text-gray-400" />
                  <Input
                    placeholder="Search exams..."
                    className="pl-8"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>

                <Select value={subjectFilter} onValueChange={setSubjectFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Subjects" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Subjects</SelectItem>
                    {subjects.map((subject) => (
                      <SelectItem key={subject} value={subject}>{subject}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="passed">Passed</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={dateFilter} onValueChange={setDateFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Time" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Time</SelectItem>
                    <SelectItem value="week">Last Week</SelectItem>
                    <SelectItem value="month">Last Month</SelectItem>
                    <SelectItem value="semester">This Semester</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Results Table */}
          <Card>
            <CardHeader>
              <CardTitle>All Results</CardTitle>
              <CardDescription>Complete list of your exam results</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Exam</TableHead>
                      <TableHead>Subject</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Score</TableHead>
                      <TableHead>Grade</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredResults.map((result) => (
                      <TableRow key={result.id}>
                        <TableCell>
                          <div>
                            <div className="font-medium">{result.examName}</div>
                            <div className="text-sm text-gray-500 dark:text-gray-400">{result.duration}</div>
                          </div>
                        </TableCell>
                        <TableCell>{result.subject}</TableCell>
                        <TableCell>{new Date(result.date).toLocaleDateString()}</TableCell>
                        <TableCell>
                          <div>
                            <div className="font-medium">{result.percentage}%</div>
                            <div className="text-sm text-gray-500 dark:text-gray-400">
                              {result.score}/{result.totalMarks}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge className={getGradeColor(result.grade)}>{result.grade}</Badge>
                        </TableCell>
                        <TableCell>{getStatusIcon(result.status)}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="sm" asChild>
                              <Link href={`/results/${result.id}`}>
                                <Eye className="h-4 w-4" />
                              </Link>
                            </Button>
                            <Button variant="ghost" size="sm">
                              <Download className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {filteredResults.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 text-gray-500">
                          No results match your filters
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Analytics Tab */}
        <TabsContent value="analytics" className="mt-6 space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Subject Performance */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Subject Performance
                </CardTitle>
                <CardDescription>Your performance across different subjects</CardDescription>
              </CardHeader>
              <CardContent>
                {subjectPerformance.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={subjectPerformance}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="subject" angle={-45} textAnchor="end" height={100} />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="score" fill="#8884d8" />
                  </BarChart>
                </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-[300px] text-gray-500">
                    No subject performance data
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Performance Metrics */}
            <Card>
              <CardHeader>
                <CardTitle>Performance Metrics</CardTitle>
                <CardDescription>Detailed analysis of your academic performance</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Overall Average</span>
                    <span className="font-medium">{stats.avgScore}%</span>
                  </div>
                  <Progress value={stats.avgScore} className="h-2" />
                </div>

                {subjectPerformance.length > 0 && (
                  <>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span>Best Subject ({[...subjectPerformance].sort((a, b) => b.score - a.score)[0]?.subject})</span>
                        <span className="font-medium">{[...subjectPerformance].sort((a, b) => b.score - a.score)[0]?.score}%</span>
                      </div>
                      <Progress value={[...subjectPerformance].sort((a, b) => b.score - a.score)[0]?.score || 0} className="h-2" />
                    </div>

                    {subjectPerformance.length > 1 && (
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span>Needs Improvement ({[...subjectPerformance].sort((a, b) => a.score - b.score)[0]?.subject})</span>
                          <span className="font-medium">{[...subjectPerformance].sort((a, b) => a.score - b.score)[0]?.score}%</span>
                        </div>
                        <Progress value={[...subjectPerformance].sort((a, b) => a.score - b.score)[0]?.score || 0} className="h-2" />
                      </div>
                    )}
                  </>
                )}

                <div className="pt-4 space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm">Pass Rate</span>
                    <span className="font-medium">{stats.passRate}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">Total Exams</span>
                    <span className="font-medium">{stats.totalExams}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">Highest Score</span>
                    <span className="font-medium text-green-600">{stats.highestScore}%</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Comparison Tab */}
        <TabsContent value="comparison" className="mt-6 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Performance Comparison</CardTitle>
              <CardDescription>Compare your performance across exams</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {data.results.slice(0, 4).map((result) => (
                  <div key={result.id} className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="font-medium">{result.examName}</span>
                      <div className="flex gap-4 text-sm">
                        <span>Your Score: {result.percentage}%</span>
                        <span className="text-gray-500">Total: {result.totalMarks}</span>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div>
                        <div className="text-xs text-gray-500 mb-1">Your Performance</div>
                        <Progress value={result.percentage} className="h-2" />
                      </div>
                    </div>
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>
                        {result.subject} • {new Date(result.date).toLocaleDateString()}
                      </span>
                      <span className={result.status === "passed" ? "text-green-600" : "text-red-600"}>
                        {result.status === "passed" ? "Passed" : "Failed"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
