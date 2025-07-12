"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Brain, Search, Plus, Clock, Users, BookOpen, ArrowRight } from "lucide-react"

export default function ExamsPage() {
  const [searchQuery, setSearchQuery] = useState("")
  const [sortBy, setSortBy] = useState("recent")
  const [filterStatus, setFilterStatus] = useState("all")

  // Mock exam data
  const exams = [
    {
      id: "1",
      title: "Introduction to AI",
      description: "Learn the fundamentals of artificial intelligence and machine learning.",
      duration: 60,
      questions: 10,
      status: "active",
      createdAt: "June 10, 2025",
      submissions: 24,
      instructor: "Dr. Sarah Chen",
      category: "Computer Science",
      difficulty: "Intermediate",
    },
    {
      id: "2",
      title: "Data Structures Final",
      description:
        "Comprehensive exam covering arrays, linked lists, trees, graphs, and algorithm complexity analysis.",
      duration: 90,
      questions: 15,
      status: "active",
      createdAt: "June 8, 2025",
      submissions: 42,
      instructor: "Prof. Michael Johnson",
      category: "Computer Science",
      difficulty: "Advanced",
    },
    {
      id: "3",
      title: "Machine Learning Midterm",
      description:
        "Covers supervised and unsupervised learning techniques, model evaluation, and basic neural networks.",
      duration: 75,
      questions: 12,
      status: "completed",
      createdAt: "June 5, 2025",
      submissions: 36,
      instructor: "Dr. Emily Rodriguez",
      category: "Data Science",
      difficulty: "Advanced",
    },
    {
      id: "4",
      title: "Web Development Basics",
      description: "Introduction to HTML, CSS, and JavaScript fundamentals.",
      duration: 45,
      questions: 8,
      status: "active",
      createdAt: "June 12, 2025",
      submissions: 18,
      instructor: "Alex Thompson",
      category: "Web Development",
      difficulty: "Beginner",
    },
    {
      id: "5",
      title: "Database Systems",
      description: "Covers relational database concepts, SQL, and database design principles.",
      duration: 60,
      questions: 10,
      status: "draft",
      createdAt: "June 14, 2025",
      submissions: 0,
      instructor: "Dr. James Wilson",
      category: "Computer Science",
      difficulty: "Intermediate",
    },
    {
      id: "6",
      title: "Python Programming",
      description: "Comprehensive assessment of Python programming skills including data structures and algorithms.",
      duration: 90,
      questions: 15,
      status: "active",
      createdAt: "June 7, 2025",
      submissions: 56,
      instructor: "Lisa Park",
      category: "Programming",
      difficulty: "Intermediate",
    },
  ]

  // Filter exams based on search query and status
  const filteredExams = exams.filter((exam) => {
    const matchesSearch =
      exam.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      exam.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      exam.instructor.toLowerCase().includes(searchQuery.toLowerCase()) ||
      exam.category.toLowerCase().includes(searchQuery.toLowerCase())

    const matchesStatus = filterStatus === "all" || exam.status === filterStatus

    return matchesSearch && matchesStatus
  })

  // Sort exams
  const sortedExams = [...filteredExams].sort((a, b) => {
    if (sortBy === "recent") {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    } else if (sortBy === "popular") {
      return b.submissions - a.submissions
    } else if (sortBy === "duration") {
      return a.duration - b.duration
    } else {
      return a.title.localeCompare(b.title)
    }
  })

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      

      <main className="container py-8">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-bold">Exams</h1>
            <p className="text-gray-500 dark:text-gray-400">Browse, create, or take exams</p>
          </div>
          <Link href="/dashboard/exams/create">
            <Button className="gap-2">
              <Plus className="h-4 w-4" /> Create New Exam
            </Button>
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_250px] gap-6">
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-500 dark:text-gray-400" />
                <Input
                  placeholder="Search exams..."
                  className="pl-8"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="w-full sm:w-[180px]">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="recent">Most Recent</SelectItem>
                  <SelectItem value="popular">Most Popular</SelectItem>
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
                {sortedExams.length > 0 ? (
                  <div className="grid gap-4">
                    {sortedExams.map((exam) => (
                      <ExamCard key={exam.id} exam={exam} />
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <p className="text-gray-500 dark:text-gray-400">No exams found matching your criteria</p>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="active" className="mt-0">
                {sortedExams.length > 0 ? (
                  <div className="grid gap-4">
                    {sortedExams.map((exam) => (
                      <ExamCard key={exam.id} exam={exam} />
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <p className="text-gray-500 dark:text-gray-400">No active exams found</p>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="completed" className="mt-0">
                {sortedExams.length > 0 ? (
                  <div className="grid gap-4">
                    {sortedExams.map((exam) => (
                      <ExamCard key={exam.id} exam={exam} />
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <p className="text-gray-500 dark:text-gray-400">No completed exams found</p>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="draft" className="mt-0">
                {sortedExams.length > 0 ? (
                  <div className="grid gap-4">
                    {sortedExams.map((exam) => (
                      <ExamCard key={exam.id} exam={exam} />
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <p className="text-gray-500 dark:text-gray-400">No draft exams found</p>
                  </div>
                )}
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

function ExamCard({ exam }) {
  const getStatusBadge = (status) => {
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
              {exam.instructor} • {exam.category}
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
            <span>{exam.duration} minutes</span>
          </div>
          <div className="flex items-center gap-1">
            <BookOpen className="h-4 w-4 text-gray-500 dark:text-gray-400" />
            <span>{exam.questions} questions</span>
          </div>
          <div className="flex items-center gap-1">
            <Users className="h-4 w-4 text-gray-500 dark:text-gray-400" />
            <span>{exam.submissions} submissions</span>
          </div>
          <div>
            <Badge variant="outline">{exam.difficulty}</Badge>
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
