import { NextRequest, NextResponse } from "next/server";
import { connect } from "@/backend/src/database/connect";
import { getAllSubjectsWithReports } from "@/backend/src/services/publishAnalysisService";
import { UniqueQuestionRepository } from "@/backend/src/database/repositories/UniqueQuestionRepository";
import { AnalysisReportRepository } from "@/backend/src/database/repositories/AnalysisReportRepository";
import { PromptRepository } from "@/backend/src/database/repositories/PromptRepository";

const uniqueQuestionRepo = new UniqueQuestionRepository();
const analysisReportRepo = new AnalysisReportRepository();
const promptRepo = new PromptRepository();

/**
 * GET /api/resources
 * Fetch subjects and their resources (PYQs, unique questions, etc.)
 */
export async function GET(request: NextRequest) {
  try {
    await connect();

    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action"); // "subjects", "pyqs", "questions"
    const subject = searchParams.get("subject");
    const branch = searchParams.get("branch");
    const semester = searchParams.get("semester");

    // Get all subjects with reports (for branch/semester selection)
    if (action === "subjects" || !action) {
      const subjects = await getAllSubjectsWithReports();
      
      console.log("Total subjects found:", subjects.length);
      if (subjects.length > 0) {
        console.log("Sample subjects:", subjects.slice(0, 3).map((s: any) => ({
          name: s.subjectName || s.name,
          branch: s.branch,
          semester: s.semester
        })));
      }

      // Group subjects by branch and semester
      const grouped: Record<string, Record<string, string[]>> = {};
      const branches = new Set<string>();
      const semesters = new Set<string>();

      subjects.forEach((s: any) => {
        const subjectBranch = s.branch || "General";
        const subjectSemester = s.semester || "Semester 1";
        
        branches.add(subjectBranch);
        semesters.add(subjectSemester);

        if (!grouped[subjectBranch]) {
          grouped[subjectBranch] = {};
        }
        if (!grouped[subjectBranch][subjectSemester]) {
          grouped[subjectBranch][subjectSemester] = [];
        }
        grouped[subjectBranch][subjectSemester].push(s.subjectName || s.name);
      });

      return NextResponse.json({
        success: true,
        data: {
          subjects: subjects.map((s: any) => ({
            id: s._id?.toString(),
            name: s.subjectName || s.name,
            code: s.code,
            branch: s.branch || "General",
            semester: s.semester || "Semester 1",
            reportCount: s.reportCount || 0,
            questionCount: s.uniqueQuestionCount || 0,
          })),
          branches: Array.from(branches).sort(),
          semesters: Array.from(semesters).sort(),
          grouped,
        },
      });
    }

    // Get PYQs (unique questions that appeared in exams) for a specific subject
    if (action === "pyqs" && subject) {
      console.log("Fetching PYQs for subject:", subject);
      
      // First, try UniqueQuestions collection
      let allQuestionsForSubject = await uniqueQuestionRepo.findBySubject(subject, {
        sortBy: "occurrenceCount",
        sortOrder: "desc",
      });
      
      console.log("Found active questions in UniqueQuestions:", allQuestionsForSubject.length);
      
      let pyqs: any[] = [];
      let stats: any = {
        totalQuestions: 0,
        totalOccurrences: 0,
        avgOccurrence: 0,
        bloomsDistribution: {},
      };

      // If UniqueQuestions collection is empty, fall back to AnalysisReports
      if (allQuestionsForSubject.length === 0) {
        console.log("UniqueQuestions empty, fetching from AnalysisReports...");
        
        const reports = await analysisReportRepo.findBySubject(subject);
        console.log(`Found ${reports.length} analysis reports for "${subject}"`);
        
        if (reports.length > 0) {
          // Collect all question IDs from all reports
          const allQuestionIds = reports.flatMap(r => r.questionIds || []);
          console.log(`Total question IDs from reports: ${allQuestionIds.length}`);
          
          // Fetch all prompts for these IDs
          const prompts = await promptRepo.findByIds(allQuestionIds);
          console.log(`Fetched ${prompts.length} prompts`);
          
          // Map prompts to PYQ format
          pyqs = prompts.map((q: any, index: number) => ({
            _id: q._id?.toString() || `q-${index + 1}`,
            id: q._id?.toString() || `q-${index + 1}`,
            title: q.questionText?.substring(0, 50) + "..." || `Question ${index + 1}`,
            questionText: q.questionText || q.text || "",
            year: reports[0]?.year || "2024",
            years: reports.map(r => r.year).filter((v, i, a) => a.indexOf(v) === i),
            examType: reports[0]?.examType || "main",
            occurrenceCount: 1,
            frequency: 1,
            bloomsLevel: q.bloomsLevel || "understand",
            topic: q.topic || subject,
            topics: q.topic ? [q.topic] : [subject],
            difficulty: getDifficultyFromBlooms(q.bloomsLevel),
            downloadCount: 0,
            sourceReports: reports.length,
            firstSeenAt: reports[0]?.publishedAt,
            lastSeenAt: reports[reports.length - 1]?.publishedAt,
          }));
          
          // Calculate stats
          stats = {
            totalQuestions: prompts.length,
            totalOccurrences: prompts.length,
            avgOccurrence: 1,
            bloomsDistribution: prompts.reduce((acc: any, q: any) => {
              const level = q.bloomsLevel || 'understand';
              acc[level] = (acc[level] || 0) + 1;
              return acc;
            }, {}),
          };
        }
      } else {
        // Use UniqueQuestions data
        pyqs = allQuestionsForSubject.map((q: any, index: number) => ({
          _id: q._id?.toString() || `q-${index + 1}`,
          id: q._id?.toString() || `q-${index + 1}`,
          title: q.text?.substring(0, 50) + "..." || `Question ${index + 1}`,
          questionText: q.text,
          year: q.lastSeenAt ? new Date(q.lastSeenAt).getFullYear().toString() : "2024",
          years: q.lastSeenAt ? [new Date(q.lastSeenAt).getFullYear().toString()] : ["2024"],
          examType: q.appearances?.[0]?.examType || "Main",
          occurrenceCount: q.occurrenceCount || 1,
          frequency: q.occurrenceCount || 1,
          bloomsLevel: q.bloomsLevel || "understand",
          topic: q.topic || subject,
          topics: q.topic ? [q.topic] : [subject],
          difficulty: getDifficultyFromBlooms(q.bloomsLevel),
          downloadCount: Math.floor(Math.random() * 200) + 50, // Placeholder
          sourceReports: q.sourceReports?.length || 1,
          firstSeenAt: q.firstSeenAt,
          lastSeenAt: q.lastSeenAt,
        }));

        const statsData = await uniqueQuestionRepo.getSubjectStats(subject);
        stats = {
          totalQuestions: statsData.totalUniqueQuestions,
          totalOccurrences: statsData.totalOccurrences,
          avgOccurrence: statsData.avgOccurrence,
          bloomsDistribution: statsData.bloomsDistribution,
        };
      }

      return NextResponse.json({
        success: true,
        data: {
          pyqs,
          stats,
        },
      });
    }

    // Get most frequent questions for a subject
    if (action === "frequent" && subject) {
      const limit = parseInt(searchParams.get("limit") || "20");
      const questions = await uniqueQuestionRepo.getMostFrequent(subject, limit);

      return NextResponse.json({
        success: true,
        data: questions.map((q: any) => ({
          id: q._id?.toString(),
          text: q.text,
          occurrenceCount: q.occurrenceCount,
          bloomsLevel: q.bloomsLevel,
          topic: q.topic,
        })),
      });
    }

    // Get subject statistics
    if (action === "stats" && subject) {
      const stats = await uniqueQuestionRepo.getSubjectStats(subject);

      return NextResponse.json({
        success: true,
        data: stats,
      });
    }

    // Default - return subjects list
    const subjects = await getAllSubjectsWithReports();

    return NextResponse.json({
      success: true,
      data: {
        totalResources: subjects.length,
        subjects: subjects.map((s: any) => ({
          name: s.subjectName || s.name,
          reportCount: s.reportCount || 0,
        })),
      },
    });
  } catch (error: any) {
    console.error("Error fetching resources:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Failed to fetch resources" },
      { status: 500 }
    );
  }
}

function getDifficultyFromBlooms(bloomsLevel: string): string {
  switch (bloomsLevel?.toLowerCase()) {
    case "remember":
    case "understand":
      return "Easy";
    case "apply":
    case "analyze":
      return "Medium";
    case "evaluate":
    case "create":
      return "Hard";
    default:
      return "Medium";
  }
}
