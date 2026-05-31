import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { submissionRepo, userRepo, examRepo } from "@/backend/dist/database/repositories/index.js";

/**
 * GET /api/results
 * Fetch all exam results/submissions for the current user
 */
export async function GET() {
  try {
    const { userId } = await auth();
    
    if (!userId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Get user by Clerk ID (Clerk ID is used as the MongoDB _id)
    const user = await userRepo.getById(userId);
    
    if (!user) {
      return NextResponse.json(
        { success: false, error: "User not found" },
        { status: 404 }
      );
    }

    // Get all submissions for this user
    const submissions = await submissionRepo.getByUser(userId);
    
    // Enrich submissions with exam details
    const results = await Promise.all(
      submissions.map(async (submission: any) => {
        // Get exam details for subject/title info
        const exam: any = await examRepo.getById(submission.examId);
        
        const percentage = submission.maxMarks > 0
          ? Math.round((submission.marksAchieved / submission.maxMarks) * 100)
          : 0;
        
        // Calculate grade based on percentage
        const grade = getGrade(percentage);
        const status = percentage >= 40 ? "passed" : "failed";
        
        return {
          id: submission._id?.toString(),
          examName: exam?.examTitle || "Unknown Exam",
          subject: exam?.examDegree || "General",
          date: submission.submittedAt,
          score: submission.marksAchieved,
          totalMarks: submission.maxMarks,
          percentage,
          grade,
          status,
          duration: submission.timeSpent ? formatDuration(submission.timeSpent) : "N/A",
          autoSubmitted: submission.autoSubmitted || false,
          evaluatorObservations: submission.evaluatorObservations,
          responsesCount: submission.responses?.length || 0,
        };
      })
    );

    // Sort by date, newest first
    results.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // Calculate summary statistics
    const totalExams = results.length;
    const passedExams = results.filter(r => r.status === "passed").length;
    const avgScore = totalExams > 0
      ? Math.round(results.reduce((sum, r) => sum + r.percentage, 0) / totalExams)
      : 0;
    const highestScore = totalExams > 0
      ? Math.max(...results.map(r => r.percentage))
      : 0;

    // Performance trend (last 5 months)
    const performanceData = calculatePerformanceTrend(results);
    
    // Subject performance
    const subjectPerformance = calculateSubjectPerformance(results);
    
    // Grade distribution
    const gradeDistribution = calculateGradeDistribution(results);

    return NextResponse.json({
      success: true,
      data: {
        results,
        stats: {
          totalExams,
          passedExams,
          avgScore,
          highestScore,
          passRate: totalExams > 0 ? Math.round((passedExams / totalExams) * 100) : 0,
        },
        performanceData,
        subjectPerformance,
        gradeDistribution,
      }
    });
  } catch (error: any) {
    console.error("Error fetching results:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Failed to fetch results" },
      { status: 500 }
    );
  }
}

// Helper functions
function getGrade(percentage: number): string {
  if (percentage >= 90) return "A+";
  if (percentage >= 80) return "A";
  if (percentage >= 70) return "B+";
  if (percentage >= 60) return "B";
  if (percentage >= 50) return "C+";
  if (percentage >= 40) return "C";
  return "F";
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes} minutes`;
}

function calculatePerformanceTrend(results: any[]): { month: string; score: number }[] {
  const monthlyScores: Record<string, { total: number; count: number }> = {};
  
  results.forEach(r => {
    const date = new Date(r.date);
    const monthKey = date.toLocaleString('default', { month: 'short' });
    
    if (!monthlyScores[monthKey]) {
      monthlyScores[monthKey] = { total: 0, count: 0 };
    }
    monthlyScores[monthKey].total += r.percentage;
    monthlyScores[monthKey].count += 1;
  });

  return Object.entries(monthlyScores)
    .map(([month, data]) => ({
      month,
      score: Math.round(data.total / data.count),
    }))
    .slice(-5); // Last 5 months
}

function calculateSubjectPerformance(results: any[]): { subject: string; score: number; color: string }[] {
  const subjectScores: Record<string, { total: number; count: number }> = {};
  const colors = ["#8884d8", "#82ca9d", "#ffc658", "#ff7300", "#00ff00", "#ff00ff", "#00ffff"];
  
  results.forEach(r => {
    if (!subjectScores[r.subject]) {
      subjectScores[r.subject] = { total: 0, count: 0 };
    }
    subjectScores[r.subject].total += r.percentage;
    subjectScores[r.subject].count += 1;
  });

  return Object.entries(subjectScores).map(([subject, data], index) => ({
    subject,
    score: Math.round(data.total / data.count),
    color: colors[index % colors.length],
  }));
}

function calculateGradeDistribution(results: any[]): { grade: string; count: number; color: string }[] {
  const gradeCounts: Record<string, number> = {};
  const gradeColors: Record<string, string> = {
    "A+": "#00ff00",
    "A": "#8884d8",
    "B+": "#82ca9d",
    "B": "#ffc658",
    "C+": "#ff7300",
    "C": "#ff9900",
    "F": "#ff0000",
  };

  results.forEach(r => {
    gradeCounts[r.grade] = (gradeCounts[r.grade] || 0) + 1;
  });

  return Object.entries(gradeCounts).map(([grade, count]) => ({
    grade,
    count,
    color: gradeColors[grade] || "#999999",
  }));
}
