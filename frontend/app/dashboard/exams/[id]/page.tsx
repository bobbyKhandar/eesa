import { Input } from "@/components/ui/input"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ArrowLeft, Clock, Users, FileText, BarChart3, Link2 } from "lucide-react"

export default function ExamDetailPage({ params }: { params: { id: string } }) {
  // This would normally fetch the exam data based on the ID
  const exam = {
    id: params.id,
    title: "Introduction to AI",
    description:
      "This exam tests fundamental concepts in artificial intelligence including search algorithms, knowledge representation, and machine learning basics.",
    duration: 60,
    questions: 10,
    totalMarks: 100,
    passingScore: 60,
    status: "Active",
    createdAt: "June 10, 2025",
    submissions: 24,
    averageScore: 76,
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/dashboard/exams">
          <Button variant="outline" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold">{exam.title}</h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant={exam.status === "Active" ? "default" : "secondary"}>{exam.status}</Badge>
            <span className="text-sm text-gray-500 dark:text-gray-400">Created on {exam.createdAt}</span>
          </div>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Exam Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-1">
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Description</p>
              <p>{exam.description}</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                <div>
                  <p className="text-sm font-medium">Duration</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{exam.duration} minutes</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                <div>
                  <p className="text-sm font-medium">Questions</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{exam.questions} questions</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                <div>
                  <p className="text-sm font-medium">Total Marks</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{exam.totalMarks} marks</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                <div>
                  <p className="text-sm font-medium">Passing Score</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{exam.passingScore}%</p>
                </div>
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex justify-between">
            <Button variant="outline">Edit Exam</Button>
            <Button variant="destructive">Delete Exam</Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Statistics</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                <div>
                  <p className="text-sm font-medium">Submissions</p>
                  <p className="text-2xl font-bold">{exam.submissions}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                <div>
                  <p className="text-sm font-medium">Average Score</p>
                  <p className="text-2xl font-bold">{exam.averageScore}%</p>
                </div>
              </div>
            </div>

            <div className="h-[200px] w-full bg-gray-100 dark:bg-gray-800 rounded-md flex items-center justify-center">
              <p className="text-gray-500 dark:text-gray-400">Score Distribution Chart</p>
            </div>
          </CardContent>
          <CardFooter>
            <Link href={`/dashboard/exams/${exam.id}/results`} className="w-full">
              <Button className="w-full">View Detailed Results</Button>
            </Link>
          </CardFooter>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Share Exam</CardTitle>
          <CardDescription>Share this exam with students</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <Input readOnly value={`https://ai-exam-evaluator.com/take-exam/${exam.id}`} className="flex-1" />
            <Button variant="outline" size="icon">
              <Link2 className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <p className="text-sm text-gray-500 dark:text-gray-400">Or share via email:</p>
            <Button variant="outline" size="sm">
              Email Invitations
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
