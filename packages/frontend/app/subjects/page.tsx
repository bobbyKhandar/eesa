"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { Button } from "@/frontend/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/frontend/components/ui/card"
import { Input } from "@/frontend/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/frontend/components/ui/select"
import { Badge } from "@/frontend/components/ui/badge"
import { BookOpen, FileText, Filter, Search, ArrowRight, Loader2, Calendar, TrendingUp } from "lucide-react"

interface SubjectSummary {
  subjectName: string
  subjectCode?: string
  branch?: string
  reportCount: number
  years: string[]
  latestYear: string
}

export default function SubjectsQuestionBankPage() {
  const [subjects, setSubjects] = useState<SubjectSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [branchFilter, setBranchFilter] = useState("all")
  const [yearFilter, setYearFilter] = useState("all")

  // Fetch subjects from API
  useEffect(() => {
    fetchSubjects()
  }, [])

  async function fetchSubjects() {
    try {
      setLoading(true)
      const response = await fetch("/api/subjects")
      const data = await response.json()
      
      if (data.subjects) {
        setSubjects(data.subjects)
      }
    } catch (error) {
      console.error("Error fetching subjects:", error)
    } finally {
      setLoading(false)
    }
  }

  // Filter subjects based on search and filters
  const filteredSubjects = subjects.filter((subject) => {
    const matchesSearch =
      subject.subjectName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      subject.subjectCode?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      false

    const matchesBranch = branchFilter === "all" || subject.branch === branchFilter
    const matchesYear = yearFilter === "all" || subject.years.includes(yearFilter)

    return matchesSearch && matchesBranch && matchesYear
  })

  // Get unique branches and years for filters
  const uniqueBranches = Array.from(new Set(subjects.map(s => s.branch).filter(Boolean)))
  const uniqueYears = Array.from(new Set(subjects.flatMap(s => s.years))).sort().reverse()

  const totalReports = subjects.reduce((sum, s) => sum + s.reportCount, 0)

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-4">
          <Loader2 className="h-12 w-12 animate-spin mx-auto text-primary" />
          <p className="text-gray-500">Loading subjects...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Subject Question Banks</h1>
          <p className="text-gray-500 dark:text-gray-400">
            Browse previous year question papers analyzed by AI across all subjects
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1">
            <BookOpen className="h-3 w-3" />
            {subjects.length} subjects
          </Badge>
          <Badge variant="outline" className="gap-1">
            <FileText className="h-3 w-3" />
            {totalReports} reports
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
            <p className="text-xs text-gray-500 dark:text-gray-400">With published papers</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Reports</CardTitle>
            <FileText className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalReports}</div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Analyzed question papers</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Branches</CardTitle>
            <TrendingUp className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{uniqueBranches.length}</div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Different departments</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Years Covered</CardTitle>
            <Calendar className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{uniqueYears.length}</div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Academic years</p>
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
          <CardDescription>Search and filter subjects by branch and year</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-500 dark:text-gray-400" />
              <Input
                placeholder="Search subjects..."
                className="pl-8"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <Select value={branchFilter} onValueChange={setBranchFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All Branches" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Branches</SelectItem>
                {uniqueBranches.map((branch) => (
                  <SelectItem key={branch} value={branch}>
                    {branch}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={yearFilter} onValueChange={setYearFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All Years" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Years</SelectItem>
                {uniqueYears.map((year) => (
                  <SelectItem key={year} value={year}>
                    {year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              variant="outline"
              onClick={() => {
                setSearchQuery("")
                setBranchFilter("all")
                setYearFilter("all")
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
          <Card key={subject.subjectName} className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <CardTitle className="text-lg">{subject.subjectName}</CardTitle>
                  <CardDescription className="mt-1">
                    {subject.subjectCode && <span className="font-mono">{subject.subjectCode}</span>}
                    {subject.branch && (
                      <>
                        {subject.subjectCode && " • "}
                        {subject.branch}
                      </>
                    )}
                  </CardDescription>
                </div>
                <Badge variant="outline" className="bg-primary/10">
                  {subject.reportCount} {subject.reportCount === 1 ? "paper" : "papers"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <Calendar className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                  <span className="font-medium">Years Available:</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {subject.years.slice(0, 5).map((year) => (
                    <Badge key={year} variant="secondary" className="text-xs">
                      {year}
                    </Badge>
                  ))}
                  {subject.years.length > 5 && (
                    <Badge variant="secondary" className="text-xs">
                      +{subject.years.length - 5} more
                    </Badge>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                <TrendingUp className="h-4 w-4" />
                <span>Latest: {subject.latestYear}</span>
              </div>

              <Button asChild size="sm" className="w-full">
                <Link href={`/subjects/${encodeURIComponent(subject.subjectName)}`}>
                  View Question Bank
                  <ArrowRight className="h-3 w-3 ml-1" />
                </Link>
              </Button>
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
              setBranchFilter("all")
              setYearFilter("all")
            }}
          >
            Clear All Filters
          </Button>
        </div>
      )}

      {subjects.length === 0 && !loading && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <FileText className="h-16 w-16 text-gray-300 dark:text-gray-600 mb-4" />
          <h2 className="text-2xl font-bold mb-2">No Published Papers Yet</h2>
          <p className="text-gray-500 dark:text-gray-400 max-w-md mb-4">
            No exam papers have been published to the question bank yet. Upload and analyze papers to get started!
          </p>
          <Button asChild>
            <Link href="/ai-analyze-bulk">
              Upload Papers
              <ArrowRight className="h-4 w-4 ml-2" />
            </Link>
          </Button>
        </div>
      )}
    </div>
  )
}
