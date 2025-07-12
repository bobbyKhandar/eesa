"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Search,
  MoreHorizontal,
  Plus,
  Download,
  Calendar,
  Clock,
  Users,
  BarChart3,
  Play,
  Pause,
  Eye,
  Copy,
  Trash2,
} from "lucide-react"

export default function AdminExams() {
  const [searchTerm, setSearchTerm] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [subjectFilter, setSubjectFilter] = useState("all")

  // Mock exam data
  const exams = [
    {
      id: 1,
      title: "Advanced Mathematics Final",
      subject: "Mathematics",
      createdBy: "Dr. Smith",
      createdDate: "2024-01-15",
      status: "active",
      duration: 120,
      totalQuestions: 50,
      submissions: 45,
      avgScore: 78.5,
      scheduledDate: "2024-02-01",
    },
    {
      id: 2,
      title: "Physics Midterm Exam",
      subject: "Physics",
      createdBy: "Prof. Johnson",
      createdDate: "2024-01-20",
      status: "draft",
      duration: 90,
      totalQuestions: 40,
      submissions: 0,
      avgScore: 0,
      scheduledDate: "2024-02-15",
    },
    {
      id: 3,
      title: "Chemistry Lab Assessment",
      subject: "Chemistry",
      createdBy: "Dr. Wilson",
      createdDate: "2024-01-18",
      status: "completed",
      duration: 60,
      totalQuestions: 30,
      submissions: 67,
      avgScore: 82.3,
      scheduledDate: "2024-01-25",
    },
    {
      id: 4,
      title: "Programming Fundamentals Quiz",
      subject: "Computer Science",
      createdBy: "Prof. Davis",
      createdDate: "2024-01-22",
      status: "scheduled",
      duration: 45,
      totalQuestions: 25,
      submissions: 0,
      avgScore: 0,
      scheduledDate: "2024-02-10",
    },
  ]

  const examStats = [
    { title: "Total Exams", value: "156", icon: Calendar, color: "blue" },
    { title: "Active Exams", value: "23", icon: Play, color: "green" },
    { title: "Total Submissions", value: "2,847", icon: Users, color: "purple" },
    { title: "Avg. Score", value: "78.5%", icon: BarChart3, color: "orange" },
  ]

  const filteredExams = exams.filter((exam) => {
    const matchesSearch =
      exam.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      exam.subject.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesStatus = statusFilter === "all" || exam.status === statusFilter
    const matchesSubject = subjectFilter === "all" || exam.subject === subjectFilter
    return matchesSearch && matchesStatus && matchesSubject
  })

  const getStatusBadge = (status: string) => {
    const variants = {
      active: "default",
      draft: "secondary",
      scheduled: "outline",
      completed: "secondary",
    } as const

    const colors = {
      active: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
      draft: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
      scheduled: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
      completed: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
    }

    return (
      <Badge className={colors[status as keyof typeof colors] || colors.draft}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Exam Management</h1>
          <p className="text-muted-foreground">Create, schedule, and monitor exams across all subjects</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm">
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
          <Button size="sm">
            <Plus className="h-4 w-4 mr-2" />
            Create Exam
          </Button>
        </div>
      </div>

      {/* Exam Statistics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {examStats.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
              <stat.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Exams Table */}
      <Card>
        <CardHeader>
          <CardTitle>Exams</CardTitle>
          <CardDescription>Manage all exams and their configurations</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-4 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search exams..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-32">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="scheduled">Scheduled</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
              </SelectContent>
            </Select>
            <Select value={subjectFilter} onValueChange={setSubjectFilter}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Subject" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Subjects</SelectItem>
                <SelectItem value="Mathematics">Mathematics</SelectItem>
                <SelectItem value="Physics">Physics</SelectItem>
                <SelectItem value="Chemistry">Chemistry</SelectItem>
                <SelectItem value="Computer Science">Computer Science</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Exam</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Questions</TableHead>
                  <TableHead>Submissions</TableHead>
                  <TableHead>Avg. Score</TableHead>
                  <TableHead className="w-[50px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredExams.map((exam) => (
                  <TableRow key={exam.id}>
                    <TableCell>
                      <div>
                        <div className="font-medium">{exam.title}</div>
                        <div className="text-sm text-muted-foreground">
                          Created by {exam.createdBy} • {exam.scheduledDate}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{exam.subject}</TableCell>
                    <TableCell>{getStatusBadge(exam.status)}</TableCell>
                    <TableCell>
                      <div className="flex items-center">
                        <Clock className="h-4 w-4 mr-1 text-muted-foreground" />
                        {exam.duration} min
                      </div>
                    </TableCell>
                    <TableCell>{exam.totalQuestions}</TableCell>
                    <TableCell>{exam.submissions}</TableCell>
                    <TableCell>{exam.avgScore > 0 ? `${exam.avgScore}%` : "N/A"}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem>
                            <Eye className="h-4 w-4 mr-2" />
                            View Details
                          </DropdownMenuItem>
                          <DropdownMenuItem>
                            <Copy className="h-4 w-4 mr-2" />
                            Duplicate
                          </DropdownMenuItem>
                          <DropdownMenuItem>
                            <BarChart3 className="h-4 w-4 mr-2" />
                            View Results
                          </DropdownMenuItem>
                          {exam.status === "active" && (
                            <DropdownMenuItem>
                              <Pause className="h-4 w-4 mr-2" />
                              Pause Exam
                            </DropdownMenuItem>
                          )}
                          {exam.status === "draft" && (
                            <DropdownMenuItem>
                              <Play className="h-4 w-4 mr-2" />
                              Start Exam
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem className="text-red-600">
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
