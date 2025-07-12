"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { BookOpen, Clock, Users, Filter, GraduationCap, Search, Plus, ArrowRight } from "lucide-react"

export default function SubjectsPage() {
  const [searchQuery, setSearchQuery] = useState("")
  const [yearFilter, setYearFilter] = useState("all")
  const [branchFilter, setBranchFilter] = useState("all")
  const [semesterFilter, setSemesterFilter] = useState("all")
  const [typeFilter, setTypeFilter] = useState("all")

  // Mock data for subjects
  const subjects = [
    {
      id: 1,
      name: "Programming Fundamentals",
      code: "CS101",
      branch: "Computer Science",
      year: "FY",
      semester: "Semester 1",
      credits: 4,
      type: "Core",
      instructor: "Dr. Sarah Johnson",
      description: "Introduction to programming concepts using C language",
      enrolledStudents: 120,
      duration: "16 weeks",
      prerequisites: [],
    },
    {
      id: 2,
      name: "Data Structures & Algorithms",
      code: "CS201",
      branch: "Computer Science",
      year: "SY",
      semester: "Semester 3",
      credits: 4,
      type: "Core",
      instructor: "Prof. Michael Chen",
      description: "Fundamental data structures and algorithmic techniques",
      enrolledStudents: 95,
      duration: "16 weeks",
      prerequisites: ["Programming Fundamentals"],
    },
    {
      id: 3,
      name: "Database Management Systems",
      code: "CS301",
      branch: "Computer Science",
      year: "TY",
      semester: "Semester 5",
      credits: 3,
      type: "Core",
      instructor: "Dr. Emily Rodriguez",
      description: "Relational database design, SQL, and database administration",
      enrolledStudents: 78,
      duration: "16 weeks",
      prerequisites: ["Data Structures & Algorithms"],
    },
    {
      id: 4,
      name: "Machine Learning",
      code: "CS401",
      branch: "Computer Science",
      year: "LY",
      semester: "Semester 7",
      credits: 3,
      type: "Elective",
      instructor: "Dr. James Wilson",
      description: "Introduction to machine learning algorithms and applications",
      enrolledStudents: 45,
      duration: "16 weeks",
      prerequisites: ["Statistics", "Linear Algebra"],
    },
    {
      id: 5,
      name: "Operating Systems",
      code: "CS202",
      branch: "Computer Science",
      year: "SY",
      semester: "Semester 4",
      credits: 4,
      type: "Core",
      instructor: "Prof. Lisa Park",
      description: "Process management, memory management, and file systems",
      enrolledStudents: 88,
      duration: "16 weeks",
      prerequisites: ["Computer Organization"],
    },
    {
      id: 6,
      name: "Web Development",
      code: "CS302",
      branch: "Computer Science",
      year: "TY",
      semester: "Semester 6",
      credits: 3,
      type: "Elective",
      instructor: "Alex Thompson",
      description: "Full-stack web development using modern frameworks",
      enrolledStudents: 62,
      duration: "16 weeks",
      prerequisites: ["Programming Fundamentals"],
    },
    {
      id: 7,
      name: "Computer Networks",
      code: "CS303",
      branch: "Computer Science",
      year: "TY",
      semester: "Semester 6",
      credits: 3,
      type: "Core",
      instructor: "Dr. Robert Kim",
      description: "Network protocols, architecture, and security",
      enrolledStudents: 72,
      duration: "16 weeks",
      prerequisites: ["Operating Systems"],
    },
    {
      id: 8,
      name: "Software Engineering",
      code: "CS304",
      branch: "Computer Science",
      year: "TY",
      semester: "Semester 5",
      credits: 3,
      type: "Core",
      instructor: "Prof. Maria Garcia",
      description: "Software development lifecycle and project management",
      enrolledStudents: 85,
      duration: "16 weeks",
      prerequisites: ["Data Structures & Algorithms"],
    },
    {
      id: 9,
      name: "Artificial Intelligence",
      code: "CS402",
      branch: "Computer Science",
      year: "LY",
      semester: "Semester 7",
      credits: 3,
      type: "Core",
      instructor: "Dr. David Lee",
      description: "AI algorithms, search techniques, and knowledge representation",
      enrolledStudents: 58,
      duration: "16 weeks",
      prerequisites: ["Data Structures & Algorithms"],
    },
    {
      id: 10,
      name: "Cybersecurity",
      code: "CS403",
      branch: "Computer Science",
      year: "LY",
      semester: "Semester 8",
      credits: 3,
      type: "Elective",
      instructor: "Prof. Jennifer Brown",
      description: "Network security, cryptography, and ethical hacking",
      enrolledStudents: 35,
      duration: "16 weeks",
      prerequisites: ["Computer Networks"],
    },
    // Add subjects from other branches
    {
      id: 11,
      name: "Circuit Analysis",
      code: "EE101",
      branch: "Electrical Engineering",
      year: "FY",
      semester: "Semester 2",
      credits: 4,
      type: "Core",
      instructor: "Dr. Thomas Anderson",
      description: "Basic circuit analysis techniques and network theorems",
      enrolledStudents: 110,
      duration: "16 weeks",
      prerequisites: ["Physics"],
    },
    {
      id: 12,
      name: "Digital Signal Processing",
      code: "EE301",
      branch: "Electrical Engineering",
      year: "TY",
      semester: "Semester 5",
      credits: 3,
      type: "Core",
      instructor: "Prof. Nancy White",
      description: "Digital signal processing techniques and applications",
      enrolledStudents: 65,
      duration: "16 weeks",
      prerequisites: ["Signals and Systems"],
    },
  ]

  // Filter subjects based on search and filters
  const filteredSubjects = subjects.filter((subject) => {
    const matchesSearch =
      subject.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      subject.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      subject.instructor.toLowerCase().includes(searchQuery.toLowerCase())

    const matchesYear = yearFilter === "all" || subject.year === yearFilter
    const matchesBranch = branchFilter === "all" || subject.branch === branchFilter
    const matchesSemester = semesterFilter === "all" || subject.semester === semesterFilter
    const matchesType = typeFilter === "all" || subject.type === typeFilter

    return matchesSearch && matchesYear && matchesBranch && matchesSemester && matchesType
  })

  const getYearBadgeColor = (year: string) => {
    switch (year) {
      case "FY":
        return "bg-blue-500"
      case "SY":
        return "bg-green-500"
      case "TY":
        return "bg-orange-500"
      case "LY":
        return "bg-purple-500"
      default:
        return "bg-gray-500"
    }
  }

  const getTypeBadgeColor = (type: string) => {
    switch (type) {
      case "Core":
        return "bg-red-500"
      case "Elective":
        return "bg-blue-500"
      default:
        return "bg-gray-500"
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Subjects</h1>
          <p className="text-gray-500 dark:text-gray-400">Browse all available subjects across different branches</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1">
            <BookOpen className="h-3 w-3" />
            {filteredSubjects.length} subjects
          </Badge>
        </div>
      </div>

      {/* Statistics Cards */}
      <div className="grid gap-6 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Subjects</CardTitle>
            <BookOpen className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{subjects.length}</div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Across all branches</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Core Subjects</CardTitle>
            <GraduationCap className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{subjects.filter((s) => s.type === "Core").length}</div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Mandatory courses</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Elective Subjects</CardTitle>
            <Filter className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{subjects.filter((s) => s.type === "Elective").length}</div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Optional courses</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Enrollment</CardTitle>
            <Users className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{subjects.reduce((sum, s) => sum + s.enrolledStudents, 0)}</div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Students enrolled</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Filter Subjects
          </CardTitle>
          <CardDescription>Filter subjects by year, branch, semester, and type</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-500 dark:text-gray-400" />
              <Input
                placeholder="Search subjects..."
                className="pl-8"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <Select value={yearFilter} onValueChange={setYearFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All Years" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Years</SelectItem>
                <SelectItem value="FY">First Year (FY)</SelectItem>
                <SelectItem value="SY">Second Year (SY)</SelectItem>
                <SelectItem value="TY">Third Year (TY)</SelectItem>
                <SelectItem value="LY">Last Year (LY)</SelectItem>
              </SelectContent>
            </Select>

            <Select value={branchFilter} onValueChange={setBranchFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All Branches" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Branches</SelectItem>
                <SelectItem value="Computer Science">Computer Science</SelectItem>
                <SelectItem value="Electrical Engineering">Electrical Engineering</SelectItem>
                <SelectItem value="Mechanical Engineering">Mechanical Engineering</SelectItem>
                <SelectItem value="Civil Engineering">Civil Engineering</SelectItem>
              </SelectContent>
            </Select>

            <Select value={semesterFilter} onValueChange={setSemesterFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All Semesters" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Semesters</SelectItem>
                <SelectItem value="Semester 1">Semester 1</SelectItem>
                <SelectItem value="Semester 2">Semester 2</SelectItem>
                <SelectItem value="Semester 3">Semester 3</SelectItem>
                <SelectItem value="Semester 4">Semester 4</SelectItem>
                <SelectItem value="Semester 5">Semester 5</SelectItem>
                <SelectItem value="Semester 6">Semester 6</SelectItem>
                <SelectItem value="Semester 7">Semester 7</SelectItem>
                <SelectItem value="Semester 8">Semester 8</SelectItem>
              </SelectContent>
            </Select>

            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All Types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="Core">Core</SelectItem>
                <SelectItem value="Elective">Elective</SelectItem>
              </SelectContent>
            </Select>

            <Button
              variant="outline"
              onClick={() => {
                setSearchQuery("")
                setYearFilter("all")
                setBranchFilter("all")
                setSemesterFilter("all")
                setTypeFilter("all")
              }}
            >
              Clear Filters
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Subjects Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredSubjects.map((subject) => (
          <Card key={subject.id} className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-lg">{subject.name}</CardTitle>
                  <CardDescription className="mt-1">
                    {subject.code} • {subject.instructor}
                  </CardDescription>
                </div>
                <div className="flex flex-col gap-1">
                  <Badge className={getYearBadgeColor(subject.year)}>{subject.year}</Badge>
                  <Badge className={getTypeBadgeColor(subject.type)} variant="outline">
                    {subject.type}
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-gray-600 dark:text-gray-400">{subject.description}</p>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <GraduationCap className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                  <span>{subject.branch}</span>
                </div>
                <div className="flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                  <span>{subject.semester}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                  <span>{subject.duration}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                  <span>{subject.enrolledStudents} students</span>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="text-sm">
                  <span className="font-medium">{subject.credits} Credits</span>
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  {subject.prerequisites.length > 0 && <span>Prerequisites: {subject.prerequisites.length}</span>}
                </div>
              </div>

              {subject.prerequisites.length > 0 && (
                <div>
                  <div className="text-sm font-medium mb-1">Prerequisites:</div>
                  <div className="flex flex-wrap gap-1">
                    {subject.prerequisites.slice(0, 2).map((prereq, index) => (
                      <Badge key={index} variant="outline" className="text-xs">
                        {prereq}
                      </Badge>
                    ))}
                    {subject.prerequisites.length > 2 && (
                      <Badge variant="outline" className="text-xs">
                        +{subject.prerequisites.length - 2} more
                      </Badge>
                    )}
                  </div>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <Button asChild size="sm" className="flex-1">
                  <Link href={`/subjects/${subject.id}`}>
                    View Details
                    <ArrowRight className="h-3 w-3 ml-1" />
                  </Link>
                </Button>
                <Button variant="outline" size="sm" className="bg-transparent">
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filteredSubjects.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <BookOpen className="h-16 w-16 text-gray-300 dark:text-gray-600 mb-4" />
          <h2 className="text-2xl font-bold mb-2">No Subjects Found</h2>
          <p className="text-gray-500 dark:text-gray-400 max-w-md">
            No subjects match your current filters. Try adjusting your search criteria or clearing the filters.
          </p>
          <Button
            variant="outline"
            className="mt-4 bg-transparent"
            onClick={() => {
              setSearchQuery("")
              setYearFilter("all")
              setBranchFilter("all")
              setSemesterFilter("all")
              setTypeFilter("all")
            }}
          >
            Clear All Filters
          </Button>
        </div>
      )}
    </div>
  )
}
