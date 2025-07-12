import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { BookOpen, FileText, BarChart3, Plus } from "lucide-react"
import { SignedOut,SignedIn } from "@clerk/nextjs"
import { SignInButton } from "@clerk/nextjs"
import { ArrowRight } from "lucide-react"
export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <SignedOut>
        <div className="flex flex-col items-center justify-center h-screen">
          <h1 className="text-2xl font-bold mb-4">Please sign in to access the dashboard</h1>
                  <SignInButton>
                  <Button size="lg" className="gap-1" >
                    Sign in <ArrowRight className="h-4 w-4" />
                  </Button>
                </SignInButton>
        </div>
      </SignedOut>

      <SignedIn>
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <Link href="/dashboard/exams/create">
          <Button className="gap-2">
            <Plus className="h-4 w-4" /> Create Exam
          </Button>
        </Link>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Exams</CardTitle>
            <BookOpen className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">12</div>
            <p className="text-xs text-gray-500 dark:text-gray-400">+2 from last month</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Completed Exams</CardTitle>
            <FileText className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">156</div>
            <p className="text-xs text-gray-500 dark:text-gray-400">+23 from last month</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Average Score</CardTitle>
            <BarChart3 className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">78%</div>
            <p className="text-xs text-gray-500 dark:text-gray-400">+2% from last month</p>
          </CardContent>
        </Card>
      </div>

      <h2 className="text-xl font-bold mt-8">Recent Exams</h2>
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {[
          {
            id: 1,
            title: "Introduction to AI",
            date: "June 10, 2025",
            submissions: 24,
            status: "Active",
          },
          {
            id: 2,
            title: "Data Structures Final",
            date: "June 8, 2025",
            submissions: 42,
            status: "Completed",
          },
          {
            id: 3,
            title: "Machine Learning Midterm",
            date: "June 5, 2025",
            submissions: 36,
            status: "Completed",
          },
        ].map((exam) => (
          <Card key={exam.id}>
            <CardHeader>
              <CardTitle>{exam.title}</CardTitle>
              <CardDescription>Created on {exam.date}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-sm">
                <p>Submissions: {exam.submissions}</p>
                <p>
                  Status:{" "}
                  <span className={exam.status === "Active" ? "text-green-500" : "text-blue-500"}>{exam.status}</span>
                </p>
              </div>
            </CardContent>
            <CardFooter>
              <Link href={`/dashboard/exams/${exam.id}`} className="w-full">
                <Button variant="outline" className="w-full">
                  View Details
                </Button>
              </Link>
            </CardFooter>
          </Card>
        ))}
      </div>
    </SignedIn>
    </div>
  )
}
