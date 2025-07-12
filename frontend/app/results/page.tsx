"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
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
} from "lucide-react"

export default function ResultsPage() {
  const [searchQuery, setSearchQuery] = useState("")
  const [subjectFilter, setSubjectFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")
  const [dateFilter, setDateFilter] = useState("all")
  const [activeTab, setActiveTab] = useState("overview")

  // Mock data for exam results
  const examResults = [
    {
      id: 1,
      examName: "Data Structures Final",
      subject: "Computer Science",
      date: "2024-01-15",
      score: 85,
      totalMarks: 100,
      percentage: 85,
      grade: "A",
      status: "passed",
      duration: "3 hours",
      rank: 12,
      totalStudents: 95,
      averageScore: 72,
    },
    {
      id: 2,
      examName: "Database Systems Midterm",
      subject: "Computer Science",
      date: "2024-01-10",
      score: 72,
      totalMarks: 100,
      percentage: 72,
      grade: "B+",
      status: "passed",
      duration: "2 hours",
      rank: 28,
      totalStudents: 88,
      averageScore: 68,
    },
    {
      id: 3,
      examName: "Operating Systems Quiz",
      subject: "Computer Science",
      date: "2024-01-05",
      score: 45,
      totalMarks: 60,
      percentage: 75,
      grade: "B",
      status: "passed",
      duration: "1 hour",
      rank: 35,
      totalStudents: 88,
      averageScore: 42,
    },
    {
      id: 4,
      examName: "Computer Networks Final",
      subject: "Computer Science",
      date: "2023-12-20",
      score: 58,
      totalMarks: 100,
      percentage: 58,
      grade: "C+",
      status: "passed",
      duration: "3 hours",
      rank: 45,
      totalStudents: 72,
      averageScore: 55,
    },
    {
      id: 5,
      examName: "Machine Learning Midterm",
      subject: "Computer Science",
      date: "2023-12-15",
      score: 92,
      totalMarks: 100,
      percentage: 92,
      grade: "A+",
      status: "passed",
      duration: "2.5 hours",
      rank: 3,
      totalStudents: 45,
      averageScore: 78,
    },
    {
      id: 6,
      examName: "Web Development Project",
      subject: "Computer Science",
      date: "2023-12-10",
      score: 88,
      totalMarks: 100,
      percentage: 88,
      grade: "A",
      status: "passed",
      duration: "Project",
      rank: 8,
      totalStudents: 62,
      averageScore: 75,
    },
  ]

  // Performance data for charts
  const performanceData = [
    { month: "Sep", score: 75 },
    { month: "Oct", score: 82 },
    { month: "Nov", score: 78 },
    { month: "Dec", score: 85 },
    { month: "Jan", score: 79 },
  ]

  const subjectPerformance = [
    { subject: "Data Structures", score: 85, color: "#8884d8" },
    { subject: "Database Systems", score: 72, color: "#82ca9d" },
    { subject: "Operating Systems", score: 75, color: "#ffc658" },
    { subject: "Computer Networks", score: 58, color: "#ff7300" },
    { subject: "Machine Learning", score: 92, color: "#00ff00" },
    { subject: "Web Development", score: 88, color: "#ff00ff" },
  ]

  const gradeDistribution = [
    { grade: "A+", count: 1, color: "#00ff00" },
    { grade: "A", count: 2, color: "#8884d8" },
    { grade: "B+", count: 1, color: "#82ca9d" },
    { grade: "B", count: 1, color: "#ffc658" },
    { grade: "C+", count: 1, color: "#ff7300" },
  ]

  // Filter results
  const filteredResults = examResults.filter((result) => {
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

  // Calculate statistics
  const averageScore = Math.round(examResults.reduce((sum, result) => sum + result.percentage, 0) / examResults.length)
  const totalExams = examResults.length
  const passedExams = examResults.filter((result) => result.status === "passed").length
  const highestScore = Math.max(...examResults.map((result) => result.percentage))

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
            <div className="text-2xl font-bold">{averageScore}%</div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              <TrendingUp className="inline h-3 w-3 mr-1" />
              +5% from last semester
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Exams</CardTitle>
            <Award className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalExams}</div>
            <p className="text-xs text-gray-500 dark:text-gray-400">This semester</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Pass Rate</CardTitle>
            <CheckCircle className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{Math.round((passedExams / totalExams) * 100)}%</div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {passedExams}/{totalExams} exams passed
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Highest Score</CardTitle>
            <TrendingUp className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{highestScore}%</div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Machine Learning Midterm</p>
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
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={performanceData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis />
                    <Tooltip />
                    <Line type="monotone" dataKey="score" stroke="#8884d8" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
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
                {examResults.slice(0, 3).map((result) => (
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
                    <SelectItem value="Computer Science">Computer Science</SelectItem>
                    <SelectItem value="Mathematics">Mathematics</SelectItem>
                    <SelectItem value="Physics">Physics</SelectItem>
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
                      <TableHead>Rank</TableHead>
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
                        <TableCell>
                          {result.rank}/{result.totalStudents}
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
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={subjectPerformance}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="subject" angle={-45} textAnchor="end" height={100} />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="score" fill="#8884d8" />
                  </BarChart>
                </ResponsiveContainer>
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
                    <span className="font-medium">{averageScore}%</span>
                  </div>
                  <Progress value={averageScore} className="h-2" />
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Best Subject (Machine Learning)</span>
                    <span className="font-medium">92%</span>
                  </div>
                  <Progress value={92} className="h-2" />
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Improvement Needed (Computer Networks)</span>
                    <span className="font-medium">58%</span>
                  </div>
                  <Progress value={58} className="h-2" />
                </div>

                <div className="pt-4 space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm">Class Rank</span>
                    <span className="font-medium">Top 25%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">Consistency Score</span>
                    <span className="font-medium">78%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">Improvement Rate</span>
                    <span className="font-medium text-green-600">+12%</span>
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
              <CardDescription>Compare your performance with class averages</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {examResults.slice(0, 4).map((result) => (
                  <div key={result.id} className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="font-medium">{result.examName}</span>
                      <div className="flex gap-4 text-sm">
                        <span>Your Score: {result.percentage}%</span>
                        <span className="text-gray-500">Class Avg: {result.averageScore}%</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <div className="text-xs text-gray-500 mb-1">Your Performance</div>
                        <Progress value={result.percentage} className="h-2" />
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 mb-1">Class Average</div>
                        <Progress value={result.averageScore} className="h-2 opacity-50" />
                      </div>
                    </div>
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>
                        Rank: {result.rank}/{result.totalStudents}
                      </span>
                      <span className={result.percentage > result.averageScore ? "text-green-600" : "text-red-600"}>
                        {result.percentage > result.averageScore ? "+" : ""}
                        {result.percentage - result.averageScore}% vs class avg
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
