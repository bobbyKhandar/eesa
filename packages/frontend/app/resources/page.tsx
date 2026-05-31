"use client"

import { useState, useEffect } from "react"
import { Button } from "@/frontend/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/frontend/components/ui/card"
import { Input } from "@/frontend/components/ui/input"
import { Label } from "@/frontend/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/frontend/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/frontend/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/frontend/components/ui/table"
import { Badge } from "@/frontend/components/ui/badge"
import { Textarea } from "@/frontend/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/frontend/components/ui/dialog"
import { FileText, Download, Upload, BookOpen, Star, ThumbsUp, Eye, Calendar, User, Search, Plus, Loader2, AlertCircle } from "lucide-react"

interface Subject {
  id: string
  name: string
  code?: string
  branch: string
  semester: string
  reportCount: number
  questionCount: number
}

interface PYQ {
  _id: string
  id?: string
  title: string
  questionText: string
  year?: string
  years?: string[]
  examType: string
  occurrenceCount: number
  frequency?: number
  bloomsLevel: string
  topic?: string
  topics?: string[]
  difficulty?: string
  downloadCount: number
  sourceReports: number
}

interface ResourcesData {
  subjects: Subject[]
  branches: string[]
  semesters: string[]
  grouped: Record<string, Record<string, string[]>>
}

interface PYQsData {
  pyqs: PYQ[]
  stats: {
    totalQuestions: number
    totalOccurrences: number
    avgOccurrence: number
    bloomsDistribution: Record<string, number>
    uniqueQuestions?: number
    subjectCount?: number
  }
}

export default function ResourcesPage() {
  const [selectedBranch, setSelectedBranch] = useState("")
  const [selectedSemester, setSelectedSemester] = useState("")
  const [selectedSubject, setSelectedSubject] = useState("")
  const [activeTab, setActiveTab] = useState("pyqs")
  const [searchQuery, setSearchQuery] = useState("")
  const [filterType, setFilterType] = useState("all")
  
  // API state
  const [loading, setLoading] = useState(true)
  const [pyqsLoading, setPyqsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resourcesData, setResourcesData] = useState<ResourcesData | null>(null)
  const [pyqsData, setPyqsData] = useState<PYQsData | null>(null)

  // Fetch initial subjects/branches/semesters data
  useEffect(() => {
    const fetchResourcesData = async () => {
      try {
        setLoading(true)
        setError(null)
        
        const response = await fetch("/api/resources?action=subjects")
        const json = await response.json()
        
        if (!response.ok || !json.success) {
          throw new Error(json.error || "Failed to fetch resources")
        }
        
        setResourcesData(json.data)
      } catch (err: any) {
        setError(err.message || "Failed to load resources")
      } finally {
        setLoading(false)
      }
    }
    
    fetchResourcesData()
  }, [])

  // Fetch PYQs when subject is selected
  useEffect(() => {
    if (!selectedSubject) {
      setPyqsData(null)
      return
    }
    
    const fetchPYQs = async () => {
      try {
        setPyqsLoading(true)
        
        const response = await fetch(`/api/resources?action=pyqs&subject=${encodeURIComponent(selectedSubject)}`)
        const json = await response.json()
        
        console.log("PYQ API Response:", json)
        
        if (!response.ok || !json.success) {
          throw new Error(json.error || "Failed to fetch questions")
        }
        
        console.log("PYQs data:", json.data)
        console.log("Number of PYQs:", json.data?.pyqs?.length || 0)
        
        setPyqsData(json.data)
      } catch (err: any) {
        console.error("Error fetching PYQs:", err)
      } finally {
        setPyqsLoading(false)
      }
    }
    
    fetchPYQs()
  }, [selectedSubject])

  // Get branches and semesters from loaded data or use defaults
  const branches = resourcesData?.branches?.length 
    ? resourcesData.branches 
    : ["Computer Science", "Electrical Engineering", "Mechanical Engineering", "Civil Engineering"]
  
  const semesters = resourcesData?.semesters?.length 
    ? resourcesData.semesters 
    : ["Semester 1", "Semester 2", "Semester 3", "Semester 4", "Semester 5", "Semester 6", "Semester 7", "Semester 8"]
  
  // Get subjects for selected branch/semester from API data or use empty array
  const getSubjectsForSelection = (): string[] => {
    if (resourcesData?.grouped && selectedBranch && selectedSemester) {
      return resourcesData.grouped[selectedBranch]?.[selectedSemester] || []
    }
    return []
  }

  // Get PYQs filtered by search
  const filteredPyqs = pyqsData?.pyqs.filter(pyq => 
    pyq.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    pyq.questionText?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    pyq.topic?.toLowerCase().includes(searchQuery.toLowerCase())
  ) || []

  console.log("Filtered PYQs count:", filteredPyqs.length)
  console.log("Search query:", searchQuery)
  console.log("PYQs data object:", pyqsData)

  // Mock data for faculty notes (keep until we have an API for notes)
  const facultyNotes = [
    {
      id: 1,
      title: "Introduction to Data Structures",
      description: "Comprehensive overview of basic data structures including arrays, linked lists, and stacks",
      uploadedBy: "Prof. Michael Chen",
      uploadDate: "2024-01-15",
      fileType: "PDF",
      fileSize: "5.2 MB",
      downloadCount: 342,
      rating: 4.8,
      tags: ["Arrays", "Linked Lists", "Stacks"],
    },
    {
      id: 2,
      title: "Advanced Tree Algorithms",
      description: "Detailed explanation of tree traversal algorithms and balanced trees",
      uploadedBy: "Prof. Michael Chen",
      uploadDate: "2024-01-10",
      fileType: "PDF",
      fileSize: "7.1 MB",
      downloadCount: 278,
      rating: 4.9,
      tags: ["Trees", "Algorithms", "BST"],
    },
    {
      id: 3,
      title: "Graph Theory and Applications",
      description: "Graph algorithms including DFS, BFS, and shortest path algorithms",
      uploadedBy: "Prof. Michael Chen",
      uploadDate: "2024-01-05",
      fileType: "PDF",
      fileSize: "6.8 MB",
      downloadCount: 195,
      rating: 4.7,
      tags: ["Graphs", "DFS", "BFS", "Dijkstra"],
    },
  ]

  // Mock data for student notes
  const studentNotes = [
    {
      id: 1,
      title: "Quick Reference: Sorting Algorithms",
      description: "Concise summary of all major sorting algorithms with time complexities",
      uploadedBy: "Alex Johnson",
      uploadDate: "2024-01-20",
      fileType: "PDF",
      fileSize: "1.5 MB",
      downloadCount: 89,
      rating: 4.5,
      likes: 23,
      verified: true,
      tags: ["Sorting", "Algorithms", "Quick Reference"],
    },
    {
      id: 2,
      title: "Data Structures Cheat Sheet",
      description: "Visual representation of common data structures with operations",
      uploadedBy: "Sarah Kim",
      uploadDate: "2024-01-18",
      fileType: "PDF",
      fileSize: "2.1 MB",
      downloadCount: 156,
      rating: 4.6,
      likes: 45,
      verified: true,
      tags: ["Cheat Sheet", "Visual", "Operations"],
    },
    {
      id: 3,
      title: "Practice Problems Solutions",
      description: "Step-by-step solutions to common data structure problems",
      uploadedBy: "Mike Wilson",
      uploadDate: "2024-01-15",
      fileType: "PDF",
      fileSize: "3.2 MB",
      downloadCount: 67,
      rating: 4.3,
      likes: 18,
      verified: false,
      tags: ["Practice", "Solutions", "Problems"],
    },
  ]

  const getDifficultyColor = (difficulty: string) => {
    switch (difficulty) {
      case "Easy":
        return "bg-green-500"
      case "Medium":
        return "bg-yellow-500"
      case "Hard":
        return "bg-red-500"
      default:
        return "bg-gray-500"
    }
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <div className="flex items-center gap-2 text-red-800 dark:text-red-200">
            <AlertCircle className="h-4 w-4" />
            <span className="font-medium">Error loading resources</span>
          </div>
          <p className="text-sm text-red-700 dark:text-red-300 mt-1">{error}</p>
        </div>
      )}
      
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Resources</h1>
          <p className="text-gray-500 dark:text-gray-400">Access study materials, notes, and learning resources</p>
        </div>
        <Dialog>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" /> Upload Resource
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Upload Resource</DialogTitle>
              <DialogDescription>Share your notes with fellow students</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="title">Title</Label>
                <Input id="title" placeholder="Enter resource title" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="description">Description</Label>
                <Textarea id="description" placeholder="Describe your resource" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="file">File</Label>
                <Input id="file" type="file" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="tags">Tags (comma separated)</Label>
                <Input id="tags" placeholder="e.g., algorithms, sorting, practice" />
              </div>
              <Button className="w-full">Upload Resource</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Statistics Cards */}
      <div className="grid gap-6 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Subjects</CardTitle>
            <FileText className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : (resourcesData?.subjects.length || 0)}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Available subjects</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total PYQs</CardTitle>
            <BookOpen className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {pyqsLoading ? <Loader2 className="h-6 w-6 animate-spin" /> : (pyqsData?.stats?.totalQuestions || 0)}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Questions available</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Unique Questions</CardTitle>
            <Star className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {pyqsLoading ? <Loader2 className="h-6 w-6 animate-spin" /> : (pyqsData?.stats?.uniqueQuestions || pyqsData?.pyqs.length || 0)}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Distinct questions</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Subjects Covered</CardTitle>
            <Upload className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {pyqsLoading ? <Loader2 className="h-6 w-6 animate-spin" /> : (pyqsData?.stats?.subjectCount || resourcesData?.subjects.length || 0)}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Different subjects</p>
          </CardContent>
        </Card>
      </div>

      {/* Subject Selection */}
      <Card>
        <CardHeader>
          <CardTitle>Select Subject</CardTitle>
          <CardDescription>Choose the branch, semester, and subject to view resources</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="branch">Branch</Label>
              <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                <SelectTrigger id="branch">
                  <SelectValue placeholder="Select branch" />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((branch) => (
                    <SelectItem key={branch} value={branch}>
                      {branch}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="semester">Semester</Label>
              <Select value={selectedSemester} onValueChange={setSelectedSemester} disabled={!selectedBranch}>
                <SelectTrigger id="semester">
                  <SelectValue placeholder="Select semester" />
                </SelectTrigger>
                <SelectContent>
                  {semesters.map((semester) => (
                    <SelectItem key={semester} value={semester}>
                      {semester}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="subject">Subject</Label>
              <Select
                value={selectedSubject}
                onValueChange={setSelectedSubject}
                disabled={!selectedBranch || !selectedSemester}
              >
                <SelectTrigger id="subject">
                  <SelectValue placeholder="Select subject" />
                </SelectTrigger>
                <SelectContent>
                  {getSubjectsForSelection().map((subject) => (
                    <SelectItem key={subject} value={subject}>
                      {subject}
                    </SelectItem>
                  ))}
                  {getSubjectsForSelection().length === 0 && selectedBranch && selectedSemester && (
                    <SelectItem value="none" disabled>No subjects available</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {selectedBranch && selectedSemester && selectedSubject && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold">{selectedSubject}</h2>
            <div className="text-sm text-gray-500 dark:text-gray-400">
              {selectedBranch} • {selectedSemester}
            </div>
          </div>

          {/* Search and Filter */}
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-500 dark:text-gray-400" />
              <Input
                placeholder="Search resources..."
                className="pl-8"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder="Filter by type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="pyqs">Previous Papers</SelectItem>
                <SelectItem value="faculty">Faculty Notes</SelectItem>
                <SelectItem value="student">Student Notes</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Tabs defaultValue="pyqs" onValueChange={setActiveTab}>
            <TabsList className="grid grid-cols-3 w-full">
              <TabsTrigger value="pyqs">Previous Year Papers</TabsTrigger>
              <TabsTrigger value="faculty">Faculty Notes</TabsTrigger>
              <TabsTrigger value="student">Student Notes</TabsTrigger>
            </TabsList>

            {/* Previous Year Question Papers */}
            <TabsContent value="pyqs" className="mt-6">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>Previous Year Question Papers</CardTitle>
                    <Button variant="outline" size="sm" className="gap-1 bg-transparent">
                      <Download className="h-4 w-4" /> Download All
                    </Button>
                  </div>
                  <CardDescription>Access past examination papers for {selectedSubject}</CardDescription>
                </CardHeader>
                <CardContent>
                  {pyqsLoading ? (
                    <div className="flex justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-gray-500" />
                    </div>
                  ) : filteredPyqs.length === 0 ? (
                    <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                      No PYQs available for {selectedSubject}
                    </div>
                  ) : (
                    <div className="rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Question</TableHead>
                            <TableHead>Year</TableHead>
                            <TableHead>Frequency</TableHead>
                            <TableHead>Difficulty</TableHead>
                            <TableHead>Action</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredPyqs.map((pyq) => (
                            <TableRow key={pyq._id}>
                              <TableCell>
                                <div className="max-w-md">
                                  <div className="font-medium line-clamp-2">{pyq.questionText}</div>
                                  {pyq.topics && pyq.topics.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mt-1">
                                      {pyq.topics.slice(0, 3).map((topic, idx) => (
                                        <Badge key={idx} variant="outline" className="text-xs">
                                          {topic}
                                        </Badge>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell>
                                {pyq.years && pyq.years.length > 0 ? (
                                  <div className="text-sm">{pyq.years.join(', ')}</div>
                                ) : (
                                  <span className="text-gray-400">N/A</span>
                                )}
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline">{pyq.frequency || 0}×</Badge>
                              </TableCell>
                              <TableCell>
                                <Badge className={getDifficultyColor(pyq.difficulty || 'medium')}>
                                  {pyq.difficulty || 'Medium'}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <Button variant="ghost" size="sm">
                                  <Eye className="h-4 w-4" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Faculty Notes */}
            <TabsContent value="faculty" className="mt-6">
              <div className="grid gap-6">
                {facultyNotes.map((note) => (
                  <Card key={note.id}>
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="text-lg">{note.title}</CardTitle>
                          <CardDescription className="mt-1">{note.description}</CardDescription>
                        </div>
                        <div className="flex items-center gap-1">
                          <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                          <span className="text-sm font-medium">{note.rating}</span>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
                        <div className="flex items-center gap-1">
                          <User className="h-4 w-4" />
                          <span>{note.uploadedBy}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Calendar className="h-4 w-4" />
                          <span>{new Date(note.uploadDate).toLocaleDateString()}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <FileText className="h-4 w-4" />
                          <span>
                            {note.fileType} • {note.fileSize}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Download className="h-4 w-4" />
                          <span>{note.downloadCount} downloads</span>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {note.tags.map((tag, index) => (
                          <Badge key={index} variant="outline" className="text-xs">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </CardContent>
                    <CardFooter className="flex gap-2">
                      <Button size="sm" className="gap-1">
                        <Download className="h-4 w-4" /> Download
                      </Button>
                      <Button variant="outline" size="sm" className="gap-1 bg-transparent">
                        <Eye className="h-4 w-4" /> Preview
                      </Button>
                    </CardFooter>
                  </Card>
                ))}
              </div>
            </TabsContent>

            {/* Student Notes */}
            <TabsContent value="student" className="mt-6">
              <div className="grid gap-6">
                {studentNotes.map((note) => (
                  <Card key={note.id}>
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <CardTitle className="text-lg">{note.title}</CardTitle>
                            {note.verified && <Badge className="bg-green-500">Verified</Badge>}
                          </div>
                          <CardDescription className="mt-1">{note.description}</CardDescription>
                        </div>
                        <div className="flex items-center gap-1">
                          <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                          <span className="text-sm font-medium">{note.rating}</span>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
                        <div className="flex items-center gap-1">
                          <User className="h-4 w-4" />
                          <span>{note.uploadedBy}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Calendar className="h-4 w-4" />
                          <span>{new Date(note.uploadDate).toLocaleDateString()}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <FileText className="h-4 w-4" />
                          <span>
                            {note.fileType} • {note.fileSize}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Download className="h-4 w-4" />
                          <span>{note.downloadCount} downloads</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <ThumbsUp className="h-4 w-4" />
                          <span>{note.likes} likes</span>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {note.tags.map((tag, index) => (
                          <Badge key={index} variant="outline" className="text-xs">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </CardContent>
                    <CardFooter className="flex gap-2">
                      <Button size="sm" className="gap-1">
                        <Download className="h-4 w-4" /> Download
                      </Button>
                      <Button variant="outline" size="sm" className="gap-1 bg-transparent">
                        <Eye className="h-4 w-4" /> Preview
                      </Button>
                      <Button variant="outline" size="sm" className="gap-1 bg-transparent">
                        <ThumbsUp className="h-4 w-4" /> Like
                      </Button>
                    </CardFooter>
                  </Card>
                ))}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      )}

      {(!selectedBranch || !selectedSemester || !selectedSubject) && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <BookOpen className="h-16 w-16 text-gray-300 dark:text-gray-600 mb-4" />
          <h2 className="text-2xl font-bold mb-2">Select a Subject</h2>
          <p className="text-gray-500 dark:text-gray-400 max-w-md">
            Choose a branch, semester, and subject to access resources, notes, and study materials.
          </p>
        </div>
      )}
    </div>
  )
}
