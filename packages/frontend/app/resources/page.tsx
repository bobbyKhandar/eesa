"use client"

import { useState, useEffect } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/frontend/components/ui/tabs"
import { BookOpen, AlertCircle } from "lucide-react"
import {
  UploadResourceDialog, StatsCards, SubjectFilter, SearchFilterBar, PyqsTable, NoteCard,
  getDifficultyColor,
} from "@/frontend/components/features/resources"
import type { PYQ, Note } from "@/frontend/components/features/resources"
import {
  EMPTY_SELECTION,
  reconcileSelection,
  selectBranch,
  selectSemester,
  type ResourceSelection,
  type SubjectCatalog,
} from "@/frontend/lib/resourceCatalog"

interface ResourcesData extends SubjectCatalog {}

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
  const [selection, setSelection] = useState<ResourceSelection>(EMPTY_SELECTION)
  const { branch: selectedBranch, semester: selectedSemester, subject: selectedSubject } = selection
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
        
        setResourcesData(json.data)      } catch (err: any) {
        setError(err.message || "Failed to load resources")
      } finally {
        setLoading(false)
      }
    }
    
    fetchResourcesData()
  }, [])

  // Drop any part of the selection the freshly loaded catalog does not offer.
  useEffect(() => {
    setSelection((current) => {
      const next = reconcileSelection(current, resourcesData)
      return next === current ? current : next
    })
  }, [resourcesData])

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
        
        if (!response.ok || !json.success) {
          throw new Error(json.error || "Failed to fetch questions")
        }
        
        setPyqsData(json.data)
      } catch (err: any) {
        console.error("Error fetching PYQs:", err)
        setPyqsData(null)
        setError(err.message || "Failed to load questions")
      } finally {
        setPyqsLoading(false)
      }
    }
    
    fetchPYQs()
  }, [selectedSubject])

  // Only offer what the API returned. These used to fall back to four hardcoded
  // branches and eight hardcoded semesters when the catalogue was empty, so a
  // user could "select" a branch that had no subjects at all.
  const branches = resourcesData?.branches ?? []
  const semesters = resourcesData?.semesters ?? []
  
  // Get subjects for selected branch/semester from API data
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
        <UploadResourceDialog />
      </div>

      <StatsCards
        loading={loading}
        pyqsLoading={pyqsLoading}
        totalSubjects={resourcesData?.uniqueSubjectCount ?? 0}
        totalQuestions={pyqsData?.stats?.totalQuestions ?? 0}
        uniqueQuestions={pyqsData?.stats?.uniqueQuestions ?? 0}
        subjectCount={pyqsData?.stats?.subjectCount ?? 0}
      />

      <SubjectFilter
        branches={branches}
        semesters={semesters}
        selectedBranch={selectedBranch}
        selectedSemester={selectedSemester}
        selectedSubject={selectedSubject}
        subjectsForSelection={getSubjectsForSelection()}
        onBranchChange={(value) => setSelection((current) => selectBranch(current, value))}
        onSemesterChange={(value) => setSelection((current) => selectSemester(current, value))}
        onSubjectChange={(value) =>
          setSelection((current) => ({ ...current, subject: value }))
        }
      />

      {selectedBranch && selectedSemester && selectedSubject && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold">{selectedSubject}</h2>
            <div className="text-sm text-gray-500 dark:text-gray-400">
              {selectedBranch} • {selectedSemester}
            </div>
          </div>

          <SearchFilterBar
            searchQuery={searchQuery}
            filterType={filterType}
            onSearchChange={setSearchQuery}
            onFilterChange={setFilterType}
          />

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid grid-cols-3 w-full">
              <TabsTrigger value="pyqs">Previous Year Papers</TabsTrigger>
              <TabsTrigger value="faculty">Faculty Notes</TabsTrigger>
              <TabsTrigger value="student">Student Notes</TabsTrigger>
            </TabsList>

            <TabsContent value="pyqs" className="mt-6">
              <PyqsTable
                subjectName={selectedSubject}
                pyqs={filteredPyqs}
                loading={pyqsLoading}
                getDifficultyColor={getDifficultyColor}
              />
            </TabsContent>

            <TabsContent value="faculty" className="mt-6">
              <div className="grid gap-6">
                {facultyNotes.map((note) => (
                  <NoteCard key={note.id} note={note} />
                ))}
              </div>
            </TabsContent>

            <TabsContent value="student" className="mt-6">
              <div className="grid gap-6">
                {studentNotes.map((note) => (
                  <NoteCard key={note.id} note={note} showLike />
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
