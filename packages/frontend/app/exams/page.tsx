"use client"
import { useEffect, useState } from "react"
import Link from "next/link"
import { Button } from "@/frontend/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/frontend/components/ui/card"
import { Input } from "@/frontend/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/frontend/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/frontend/components/ui/select"
import { Badge } from "@/frontend/components/ui/badge"
import { Search, Plus, Clock, Users, BookOpen, ArrowRight } from "lucide-react"
import { useUser } from "@clerk/nextjs"

interface ExamSummary {
  id: string
  title: string
  description?: string
  subject?: string
  degree?: string
  type?: string
  duration?: number
  questions: number
  maxMarks?: number
  createdAt?: string
  status: string
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function timeOf(value: unknown): number {
  const time = new Date(textOf(value)).getTime()
  return Number.isNaN(time) ? 0 : time
}

export default function ExamsPage() {
  const { user, isLoaded } = useUser()
  const [exams, setExams] = useState<ExamSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [sortBy, setSortBy] = useState("recent")
  const [filterStatus, setFilterStatus] = useState("all")

  useEffect(() => {
    if (!isLoaded) return

    if (!user?.id) {
      setExams([])
      setLoading(false)
      return
    }

    const controller = new AbortController()
    let active = true

    const fetchExams = async () => {
      try {
        setLoading(true)
        setError(null)
        const response = await fetch("/api/exams/list", {
          signal: controller.signal,
          cache: "no-store",
        })
        const data = await response.json()

        if (!response.ok || !data.success) {
          throw new Error(data.error || "Failed to fetch exams")
        }

        if (active) setExams(Array.isArray(data.exams) ? data.exams : [])
      } catch (err: any) {
        if (!active || controller.signal.aborted) return
        setError(err.message || "Failed to load exams")
      } finally {
        if (active) setLoading(false)
      }
    }

    fetchExams()

    return () => {
      active = false
      controller.abort()
    }
  }, [isLoaded, user?.id])

  // Filter exams based on search query and status
  const query = searchQuery.toLowerCase()
  const filteredExams = exams.filter((exam) => {
    const matchesSearch =
      textOf(exam.title).toLowerCase().includes(query) ||
      textOf(exam.description).toLowerCase().includes(query) ||
      textOf(exam.subject).toLowerCase().includes(query) ||
      textOf(exam.degree).toLowerCase().includes(query)

    const matchesStatus = filterStatus === "all" || exam.status === filterStatus

    return matchesSearch && matchesStatus
  })

  // Sort exams
  const sortedExams = [...filteredExams].sort((a, b) => {
    if (sortBy === "recent") {
      return timeOf(b.createdAt) - timeOf(a.createdAt)
    } else if (sortBy === "duration") {
      return (a.duration || 0) - (b.duration || 0)
    } else {
      return textOf(a.title).localeCompare(textOf(b.title))
    }
  })

  const renderExams = (emptyMessage: string) => {
    if (sortedExams.length > 0) {
      return (
        <div className="grid gap-4">
          {sortedExams.map((exam) => (
            <ExamCard key={exam.id} exam={exam} />
          ))}
        </div>
      )
    }
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 dark:text-gray-400">{loading ? "Loading exams..." : emptyMessage}</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      

      <main className="container py-8">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-bold">Exams</h1>
            <p className="text-gray-500 dark:text-gray-400">Exams assigned to you, ready to take</p>
          </div>
          <Link href="/dashboard/exams/create">
            <Button className="gap-2">
              <Plus className="h-4 w-4" /> Create New Exam
            </Button>
          </Link>
        </div>

        {error && (
          <div className="mb-6 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 p-4">
            <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-[1fr_250px] gap-6">
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-500 dark:text-gray-400" />
                <Input
                  placeholder="Search exams..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8"
                />
              </div>
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="w-full sm:w-[180px]">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="recent">Most Recent</SelectItem>
                  <SelectItem value="alphabetical">Alphabetical</SelectItem>
                  <SelectItem value="duration">Duration</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Tabs defaultValue="all" className="w-full" onValueChange={setFilterStatus}>
              <TabsList className="grid grid-cols-4 mb-4">
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="active">Active</TabsTrigger>
                <TabsTrigger value="completed">Completed</TabsTrigger>
                <TabsTrigger value="draft">Drafts</TabsTrigger>
              </TabsList>

              <TabsContent value="all" className="mt-0">
                {renderExams("No exams found matching your criteria")}
              </TabsContent>

              <TabsContent value="active" className="mt-0">
                {renderExams("No active exams found")}
              </TabsContent>

              <TabsContent value="completed" className="mt-0">
                {renderExams("No completed exams found")}
              </TabsContent>

              <TabsContent value="draft" className="mt-0">
                {renderExams("No draft exams found")}
              </TabsContent>
            </Tabs>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Categories</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm">
                    Computer Science
                  </Button>
                  <Button variant="outline" size="sm">
                    Data Science
                  </Button>
                  <Button variant="outline" size="sm">
                    Web Development
                  </Button>
                  <Button variant="outline" size="sm">
                    Programming
                  </Button>
                  <Button variant="outline" size="sm">
                    Mathematics
                  </Button>
                  <Button variant="outline" size="sm">
                    Physics
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Difficulty</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm">
                    Beginner
                  </Button>
                  <Button variant="outline" size="sm">
                    Intermediate
                  </Button>
                  <Button variant="outline" size="sm">
                    Advanced
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Quick Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button variant="outline" className="w-full justify-start gap-2">
                  <BookOpen className="h-4 w-4" /> My Enrolled Exams
                </Button>
                <Button variant="outline" className="w-full justify-start gap-2">
                  <Clock className="h-4 w-4" /> Recent Exams
                </Button>
                <Button variant="outline" className="w-full justify-start gap-2">
                  <Users className="h-4 w-4" /> Popular Exams
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  )
}

function ExamCard({ exam }: { exam: ExamSummary }) {
  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <Badge className="bg-green-500">Active</Badge>
      case "completed":
        return <Badge variant="secondary">Completed</Badge>
      case "draft":
        return <Badge variant="outline">Draft</Badge>
      default:
        return null
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>{exam.title}</CardTitle>
            <CardDescription>
              {exam.subject || "Unassigned subject"}
              {exam.degree ? ` • ${exam.degree}` : ""}
              {exam.type ? ` • ${exam.type}` : ""}
            </CardDescription>
          </div>
          {getStatusBadge(exam.status)}
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{exam.description}</p>
        <div className="flex flex-wrap gap-4 text-sm">
          <div className="flex items-center gap-1">
            <Clock className="h-4 w-4 text-gray-500 dark:text-gray-400" />
            <span>{exam.duration || 60} minutes</span>
          </div>
          <div className="flex items-center gap-1">
            <BookOpen className="h-4 w-4 text-gray-500 dark:text-gray-400" />
            <span>{exam.questions} questions • {exam.maxMarks} marks</span>
          </div>
        </div>
      </CardContent>
      <CardFooter className="flex flex-col sm:flex-row gap-3">
        {exam.status !== "draft" && (
          <Link href={`/take-exam/${exam.id}`} className="w-full sm:w-auto">
            <Button className="w-full">Take Exam</Button>
          </Link>
        )}
        <Link href={`/dashboard/exams/${exam.id}`} className="w-full sm:w-auto">
          <Button variant="outline" className="w-full gap-1">
            View Details <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
      </CardFooter>
    </Card>
  )
}
