"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { BookOpen, FileText, BarChart3, Plus } from "lucide-react";

export default function DashboardPage() {
  const [userInfo, getuserInfo] = useState(null);
  const [averageScore, setAverageScore] = useState(null);
  useEffect(() => {
    async function getuserrole() {
      const res = await fetch("/api/user?email=bobby.k@somaiya.edu");
      const data = await res.json();
      console.log(data);
      getuserInfo(data);
    }
    getuserrole();
  }, []);
  useEffect(() => {
    async function computeAverageScore() {
      if (userInfo?.userHistory?.length) {
        let total = 0;
        let allocated = 0;

        userInfo.userHistory.forEach((exam) => {
          total += exam.total;
          allocated += exam.allocated;
        });

        const avg = allocated ? ((allocated / total) * 100).toFixed(2) : 0;
        setAverageScore(avg);
      }
    }

    computeAverageScore();
  }, [userInfo]);
  return (
    <div className="space-y-6">
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
            <div className="text-2xl font-bold">
              {userInfo ? userInfo.totalAllocatedExams : "loading..."}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400"></p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">
              <div className="text-2xl font-bold">Completed Exams</div>
            </CardTitle>
            <FileText className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          </CardHeader>
          <CardContent>
            {userInfo ? userInfo.totalCompletedExams : "loading..."}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Average Score</CardTitle>
            <BarChart3 className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {averageScore ? averageScore : "loading..."}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              +2% from last month
            </p>
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
                  <span
                    className={
                      exam.status === "Active"
                        ? "text-green-500"
                        : "text-blue-500"
                    }
                  >
                    {exam.status}
                  </span>
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
    </div>
  );
}
