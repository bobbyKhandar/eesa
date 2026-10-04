"use client"

import { Suspense, useState, useEffect } from "react"
import { useSearchParams } from "next/navigation"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/frontend/components/ui/tabs"
import { BookOpen, AlertCircle } from "lucide-react"
import {
  UploadResourceDialog, SharedNotes, StatsCards, SubjectFilter, SearchFilterBar, PyqsTable,
  getDifficultyColor,
} from "@/frontend/components/features/resources"
import type { PYQ } from "@/frontend/components/features/resources"
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
  return <Suspense fallback={<p role="status">Loading resources...</p>}><ResourcesContent /></Suspense>
}

function ResourcesContent() {
  const linkedSubject = useSearchParams().get("subject")
  const [selection, setSelection] = useState<ResourceSelection>(EMPTY_SELECTION)
  const { branch: selectedBranch, semester: selectedSemester, subject: selectedSubject } = selection
  const [activeTab, setActiveTab] = useState("pyqs")
  const [searchQuery, setSearchQuery] = useState("")
  const [filterType, setFilterType] = useState("all")
  const [notesRefresh, setNotesRefresh] = useState(0)
  
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

  // Global search can deep-link to a resource subject. Resolve it through the
  // loaded catalogue so the branch and semester pickers remain consistent.
  useEffect(() => {
    const subjectName = linkedSubject
    if (!subjectName || !resourcesData) return
    const subject = resourcesData.subjects.find(item => item.name === subjectName)
    if (subject?.semesters.length) {
      setSelection({ branch: subject.branch, semester: subject.semesters[0], subject: subject.name })
    }
  }, [resourcesData, linkedSubject])

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
        <UploadResourceDialog subject={selectedSubject || ""} onUploaded={() => setNotesRefresh(value => value + 1)} />
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
            </TabsList>

            <TabsContent value="pyqs" className="mt-6">
              <PyqsTable
                subjectName={selectedSubject}
                pyqs={filteredPyqs}
                loading={pyqsLoading}
                getDifficultyColor={getDifficultyColor}
              />
            </TabsContent>

          </Tabs>
        </div>
      )}

      <SharedNotes refreshKey={notesRefresh} />

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
