//NOTE ALL EXAMS ARE FORCEFULLY GETTING TAGGED AS ACTIVE.Changes to this functionality are scheduled for future updates.
"use client"
import Link from "next/link"
import { useState, useEffect } from "react"
import { Button } from "@/frontend/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/frontend/components/ui/card"
import { Input } from "@/frontend/components/ui/input"
import { Badge } from "@/frontend/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/frontend/components/ui/tabs"
import { Search, Plus, Clock, BookOpen, ArrowRight, Eye, Edit, Trash2, Users } from "lucide-react"
import { useUser } from "@clerk/nextjs"

export default function DashboardExamsPage() {
  const { user } = useUser()
  const [exams, setExams] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")

  useEffect(() => {
    console.log("useEffect triggered, user:", user?.id);
    
    if (!user?.id) {
      console.log("No user ID, skipping fetch");
      return;
    }

    const fetchExams = async () => {
      try {
        console.log("Starting fetchExams...");
        setLoading(true)
        const response = await fetch('/api/exams/list')
        console.log("Response received:", response.status);
        const data = await response.json()
        console.log("Data:", data)
        
        if (!response.ok || !data.success) {
          throw new Error(data.error || 'Failed to fetch exams')
        }

        setExams(data.exams || [])
      } catch (err: any) {
        setError(err.message || 'Failed to load exams')
        console.error('Error fetching exams:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchExams()
  }, [user?.id])

  // Filter exams based on search query
  const filteredExams = exams.filter(exam =>
    exam.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    exam.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    exam.subject?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">Exams</h1>
          <Link href="/dashboard/exams/create">
            <Button className="gap-2">
              <Plus className="h-4 w-4" /> Create Exam
            </Button>
          </Link>
        </div>
        <div className="text-center py-12">
          <p className="text-gray-500 dark:text-gray-400">Loading exams...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">Exams</h1>
          <Link href="/dashboard/exams/create">
            <Button className="gap-2">
              <Plus className="h-4 w-4" /> Create Exam
            </Button>
          </Link>
        </div>
        <div className="text-center py-12">
          <p className="text-red-500">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Exams</h1>
        <Link href="/dashboard/exams/create">
          <Button className="gap-2">
            <Plus className="h-4 w-4" /> Create Exam
          </Button>
        </Link>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-500 dark:text-gray-400" />
          <Input 
            placeholder="Search exams by title, description, or subject..." 
            className="pl-8"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {filteredExams.length === 0 && !loading && (
        <div className="text-center py-12">
          <p className="text-gray-500 dark:text-gray-400">
            {searchQuery ? 'No exams found matching your search' : 'No exams created yet'}
          </p>
          {!searchQuery && (
            <Link href="/dashboard/exams/create">
              <Button className="mt-4 gap-2">
                <Plus className="h-4 w-4" /> Create Your First Exam
              </Button>
            </Link>
          )}
        </div>
      )}

      <Tabs defaultValue="all" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="all">All ({filteredExams.length})</TabsTrigger>
          <TabsTrigger value="active">Active ({filteredExams.filter(e => e.status === "active").length})</TabsTrigger>
          <TabsTrigger value="scheduled">Scheduled ({filteredExams.filter(e => e.status === "scheduled").length})</TabsTrigger>
          <TabsTrigger value="draft">Drafts ({filteredExams.filter(e => e.status === "draft").length})</TabsTrigger>
        </TabsList>
        <TabsContent value="all" className="mt-6">
          <div className="grid gap-4">
            {filteredExams.map((exam) => (
              <ExamCard key={exam.id} exam={exam} />
            ))}
          </div>
        </TabsContent>
        <TabsContent value="active" className="mt-6">
          <div className="grid gap-4">
            {filteredExams
              .filter((exam) => exam.status === "active")
              .map((exam) => (
                <ExamCard key={exam.id} exam={exam} />
              ))}
          </div>
        </TabsContent>
        <TabsContent value="scheduled" className="mt-6">
          <div className="grid gap-4">
            {filteredExams
              .filter((exam) => exam.status === "scheduled")
              .map((exam) => (
                <ExamCard key={exam.id} exam={exam} />
              ))}
          </div>
        </TabsContent>
        <TabsContent value="draft" className="mt-6">
          <div className="grid gap-4">
            {filteredExams
              .filter((exam) => exam.status === "draft")
              .map((exam) => (
                <ExamCard key={exam.id} exam={exam} />
              ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function ExamCard({ exam }: { exam: any }) {
  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <Badge className="bg-green-500">Active</Badge>
      case "scheduled":
        return <Badge className="bg-blue-500">Scheduled</Badge>
      case "draft":
        return <Badge variant="outline">Draft</Badge>
      default:
        return null
    }
  }

  const formatDate = (date: string | Date) => {
    if (!date) return 'N/A'
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <CardTitle>{exam.title}</CardTitle>
            <CardDescription>
              Created on {formatDate(exam.createdAt)}
              {exam.scheduledAt && ` • Scheduled for ${formatDate(exam.scheduledAt)}`}
            </CardDescription>
          </div>
          {getStatusBadge(exam.status)}
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">{exam.description}</p>
        <div className="flex items-center gap-2 mb-4">
          <Badge variant="secondary">{exam.subject}</Badge>
          <Badge variant="outline">{exam.degree}</Badge>
          <Badge variant="outline">{exam.type}</Badge>
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          <div className="flex items-center gap-1">
            <Clock className="h-4 w-4 text-gray-500 dark:text-gray-400" />
            <span>{exam.duration || 60} minutes</span>
          </div>
          <div className="flex items-center gap-1">
            <BookOpen className="h-4 w-4 text-gray-500 dark:text-gray-400" />
            <span>{exam.questions} questions • {exam.maxMarks} marks</span>
          </div>
          {exam.assignedUsers > 0 && (
            <div className="flex items-center gap-1">
              <Users className="h-4 w-4 text-gray-500 dark:text-gray-400" />
              <span>{exam.assignedUsers} assigned</span>
            </div>
          )}
          {exam.negativeMarking && (
            <Badge variant="outline" className="text-xs">
              Negative Marking
            </Badge>
          )}
        </div>
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        <Link href={`/dashboard/exams/${exam.id}`}>
          <Button variant="outline" size="sm" className="gap-1">
            <Eye className="h-4 w-4" /> View
          </Button>
        </Link>
        <Link href={`/dashboard/exams/${exam.id}/edit`}>
          <Button variant="outline" size="sm" className="gap-1">
            <Edit className="h-4 w-4" /> Edit
          </Button>
        </Link>
        <Button 
          variant="outline" 
          size="sm" 
          className="gap-1 text-red-500 hover:text-red-500"
          onClick={async () => {
            if (confirm('Are you sure you want to delete this exam?')) {
              try {
                const response = await fetch(`/api/exams/${exam.id}`, {
                  method: 'DELETE'
                })
                if (response.ok) {
                  window.location.reload()
                }
              } catch (err) {
                console.error('Error deleting exam:', err)
              }
            }
          }}
        >
          <Trash2 className="h-4 w-4" /> Delete
        </Button>
        {exam.status !== "draft" && (
          <Link href={`/take-exam/${exam.id}`} className="ml-auto">
            <Button size="sm" className="gap-1">
              Take Exam <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        )}
      </CardFooter>
    </Card>
  )
}
