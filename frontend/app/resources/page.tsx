"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { FileText, Download, Upload, BookOpen, Star, ThumbsUp, Eye, Calendar, User, Search, Plus } from "lucide-react"

export default function ResourcesPage() {
  const [selectedBranch, setSelectedBranch] = useState("")
  const [selectedSemester, setSelectedSemester] = useState("")
  const [selectedSubject, setSelectedSubject] = useState("")
  const [activeTab, setActiveTab] = useState("pyqs")
  const [searchQuery, setSearchQuery] = useState("")
  const [filterType, setFilterType] = useState("all")

  // Mock data for branches, semesters, and subjects
  const branches = ["Computer Science", "Electrical Engineering", "Mechanical Engineering", "Civil Engineering"]
  const semesters = [
    "Semester 1",
    "Semester 2",
    "Semester 3",
    "Semester 4",
    "Semester 5",
    "Semester 6",
    "Semester 7",
    "Semester 8",
  ]
  const subjects = {
    "Computer Science": {
      "Semester 1": ["Programming Fundamentals", "Digital Logic", "Mathematics I"],
      "Semester 2": ["Data Structures", "Computer Organization", "Mathematics II"],
      "Semester 3": ["Data Structures & Algorithms", "Database Systems", "Operating Systems"],
      "Semester 4": ["Computer Networks", "Software Engineering", "Web Technologies"],
      "Semester 5": ["Machine Learning", "Artificial Intelligence", "Cybersecurity"],
      "Semester 6": ["Distributed Systems", "Mobile Computing", "Cloud Computing"],
    },
    "Electrical Engineering": {
      "Semester 1": ["Basic Electrical Engineering", "Physics", "Mathematics I"],
      "Semester 2": ["Circuit Theory", "Electronics", "Mathematics II"],
    },
  }

  // Mock data for PYQs
  const pyqs = [
    {
      id: 1,
      title: "Data Structures Midterm 2023",
      year: "2023",
      examType: "Midterm",
      duration: "3 hours",
      totalMarks: 100,
      downloadCount: 245,
      uploadedBy: "Faculty",
      uploadDate: "2023-12-15",
      fileSize: "2.5 MB",
      difficulty: "Medium",
    },
    {
      id: 2,
      title: "Data Structures Final 2023",
      year: "2023",
      examType: "Final",
      duration: "3 hours",
      totalMarks: 100,
      downloadCount: 189,
      uploadedBy: "Faculty",
      uploadDate: "2023-05-20",
      fileSize: "3.1 MB",
      difficulty: "Hard",
    },
    {
      id: 3,
      title: "Data Structures Quiz 2022",
      year: "2022",
      examType: "Quiz",
      duration: "1 hour",
      totalMarks: 50,
      downloadCount: 156,
      uploadedBy: "Faculty",
      uploadDate: "2022-11-10",
      fileSize: "1.8 MB",
      difficulty: "Easy",
    },
  ]

  // Mock data for faculty notes
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
            <CardTitle className="text-sm font-medium">Total Resources</CardTitle>
            <FileText className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">1,247</div>
            <p className="text-xs text-gray-500 dark:text-gray-400">+12% from last month</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Downloads</CardTitle>
            <Download className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">45,231</div>
            <p className="text-xs text-gray-500 dark:text-gray-400">+8% from last month</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Faculty Notes</CardTitle>
            <BookOpen className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">342</div>
            <p className="text-xs text-gray-500 dark:text-gray-400">+5 new this week</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Student Uploads</CardTitle>
            <Upload className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">905</div>
            <p className="text-xs text-gray-500 dark:text-gray-400">+23 this week</p>
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
                  {selectedBranch &&
                    selectedSemester &&
                    subjects[selectedBranch]?.[selectedSemester]?.map((subject) => (
                      <SelectItem key={subject} value={subject}>
                        {subject}
                      </SelectItem>
                    ))}
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
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Title</TableHead>
                          <TableHead>Year</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Duration</TableHead>
                          <TableHead>Marks</TableHead>
                          <TableHead>Difficulty</TableHead>
                          <TableHead>Downloads</TableHead>
                          <TableHead>Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pyqs.map((paper) => (
                          <TableRow key={paper.id}>
                            <TableCell>
                              <div>
                                <div className="font-medium">{paper.title}</div>
                                <div className="text-sm text-gray-500 dark:text-gray-400">
                                  {paper.fileSize} • Uploaded by {paper.uploadedBy}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>{paper.year}</TableCell>
                            <TableCell>
                              <Badge variant="outline">{paper.examType}</Badge>
                            </TableCell>
                            <TableCell>{paper.duration}</TableCell>
                            <TableCell>{paper.totalMarks}</TableCell>
                            <TableCell>
                              <Badge className={getDifficultyColor(paper.difficulty)}>{paper.difficulty}</Badge>
                            </TableCell>
                            <TableCell>{paper.downloadCount}</TableCell>
                            <TableCell>
                              <Button variant="ghost" size="sm">
                                <Download className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
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
