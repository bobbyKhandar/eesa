import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Search,
  Plus,
  Clock,
  BookOpen,
  ArrowRight,
  Eye,
  Edit,
  Trash2,
} from "lucide-react";

export default function DashboardExamsPage() {
  // Mock exam data
  const exams = [
    {
      id: "1",
      title: "Introduction to AI",
      description:
        "Learn the fundamentals of artificial intelligence and machine learning.",
      duration: 60,
      questions: 10,
      status: "active",
      createdAt: "June 10, 2025",
      submissions: 24,
    },
    {
      id: "2",
      title: "Data Structures Final",
      description:
        "Comprehensive exam covering arrays, linked lists, trees, graphs, and algorithm complexity analysis.",
      duration: 90,
      questions: 15,
      status: "active",
      createdAt: "June 8, 2025",
      submissions: 42,
    },
    {
      id: "3",
      title: "Machine Learning Midterm",
      description:
        "Covers supervised and unsupervised learning techniques, model evaluation, and basic neural networks.",
      duration: 75,
      questions: 12,
      status: "completed",
      createdAt: "June 5, 2025",
      submissions: 36,
    },
    {
      id: "4",
      title: "Web Development Basics",
      description: "Introduction to HTML, CSS, and JavaScript fundamentals.",
      duration: 45,
      questions: 8,
      status: "draft",
      createdAt: "June 12, 2025",
      submissions: 0,
    },
  ];

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
          <Input placeholder="Search exams..." className="pl-8" />
        </div>
      </div>

      <Tabs defaultValue="all" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="completed">Completed</TabsTrigger>
          <TabsTrigger value="draft">Drafts</TabsTrigger>
        </TabsList>
        <TabsContent value="all" className="mt-6">
          <div className="grid gap-4">
            {exams.map((exam) => (
              <ExamCard key={exam.id} exam={exam} />
            ))}
          </div>
        </TabsContent>
        <TabsContent value="active" className="mt-6">
          <div className="grid gap-4">
            {exams
              .filter((exam) => exam.status === "active")
              .map((exam) => (
                <ExamCard key={exam.id} exam={exam} />
              ))}
          </div>
        </TabsContent>
        <TabsContent value="completed" className="mt-6">
          <div className="grid gap-4">
            {exams
              .filter((exam) => exam.status === "completed")
              .map((exam) => (
                <ExamCard key={exam.id} exam={exam} />
              ))}
          </div>
        </TabsContent>
        <TabsContent value="draft" className="mt-6">
          <div className="grid gap-4">
            {exams
              .filter((exam) => exam.status === "draft")
              .map((exam) => (
                <ExamCard key={exam.id} exam={exam} />
              ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ExamCard({ exam }) {
  const getStatusBadge = (status) => {
    switch (status) {
      case "active":
        return <Badge className="bg-green-500">Active</Badge>;
      case "completed":
        return <Badge variant="secondary">Completed</Badge>;
      case "draft":
        return <Badge variant="outline">Draft</Badge>;
      default:
        return null;
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>{exam.title}</CardTitle>
            <CardDescription>Created on {exam.createdAt}</CardDescription>
          </div>
          {getStatusBadge(exam.status)}
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          {exam.description}
        </p>
        <div className="flex flex-wrap gap-4 text-sm">
          <div className="flex items-center gap-1">
            <Clock className="h-4 w-4 text-gray-500 dark:text-gray-400" />
            <span>{exam.duration} minutes</span>
          </div>
          <div className="flex items-center gap-1">
            <BookOpen className="h-4 w-4 text-gray-500 dark:text-gray-400" />
            <span>{exam.questions} questions</span>
          </div>
          {exam.status !== "draft" && (
            <div className="flex items-center gap-1">
              <Eye className="h-4 w-4 text-gray-500 dark:text-gray-400" />
              <span>{exam.submissions} submissions</span>
            </div>
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
        >
          <Trash2 className="h-4 w-4" /> Delete
        </Button>
        {exam.status !== "draft" && (
          <Link href={`/take-exam/${exam.id}`} className="ml-auto">
            <Button size="sm" className="gap-1">
              Preview <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        )}
      </CardFooter>
    </Card>
  );
}
