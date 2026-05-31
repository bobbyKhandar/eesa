import { NextRequest, NextResponse } from "next/server";
import { UniqueQuestionRepository } from "@/backend/src/database/repositories/UniqueQuestionRepository";
import { PromptRepository } from "@/backend/src/database/repositories/PromptRepository";
import { connect } from "@/backend/src/database/connect";

const uniqueQuestionRepo = new UniqueQuestionRepository();
const promptRepo = new PromptRepository();

export async function GET(request: NextRequest) {
  try {
    await connect();

    const { searchParams } = new URL(request.url);
    const subject = searchParams.get("subject");
    const bloomsLevel = searchParams.get("bloomsLevel");
    const minOccurrence = searchParams.get("minOccurrence");
    const sortBy = searchParams.get("sortBy") as "occurrenceCount" | "firstSeenAt" | "lastSeenAt" | undefined;
    const sortOrder = searchParams.get("sortOrder") as "asc" | "desc" | undefined;
    const searchText = searchParams.get("search");
    const action = searchParams.get("action"); // "stats" or "frequent"

    if (!subject) {
      return NextResponse.json(
        { error: "Subject parameter is required" },
        { status: 400 }
      );
    }

    // Try UniqueQuestionRepository first
    let questions: any[] = [];
    let stats: any = null;

    // Get subject statistics
    if (action === "stats") {
      stats = await uniqueQuestionRepo.getSubjectStats(subject);
      
      // If no questions in UniqueQuestions, use Prompts as fallback
      if (!stats || stats.totalUniqueQuestions === 0) {
        console.log('[Unique Questions API] UniqueQuestions empty, using Prompts as fallback');
        const prompts = await promptRepo.findBySubject(subject);
        
        // Calculate stats from Prompts with similarQuestions
        const promptsWithSimilarity = prompts.filter((p: any) => p.hasSimilarQuestions);
        const bloomsDistribution: Record<string, number> = {};
        
        prompts.forEach((p: any) => {
          const bloom = p.bloomLevel || p.bloomsLevel || 'Unknown';
          bloomsDistribution[bloom] = (bloomsDistribution[bloom] || 0) + 1;
        });
        
        stats = {
          totalUniqueQuestions: prompts.length,
          totalOccurrences: prompts.length,
          avgOccurrence: 1,
          bloomsDistribution,
          withSimilarQuestions: promptsWithSimilarity.length
        };
      }
      
      return NextResponse.json(stats);
    }

    // Get most frequent questions
    if (action === "frequent") {
      const limit = parseInt(searchParams.get("limit") || "10");
      questions = await uniqueQuestionRepo.getMostFrequent(subject, limit);
      
      // Fallback to Prompts with highest appearance frequency
      if (!questions || questions.length === 0) {
        console.log('[Unique Questions API] Using Prompts for frequent questions');
        const prompts = await promptRepo.findBySubject(subject);
        
        // Sort by appearanceFrequency.count
        questions = prompts
          .filter((p: any) => p.appearanceFrequency?.count)
          .sort((a: any, b: any) => 
            (b.appearanceFrequency?.count || 0) - (a.appearanceFrequency?.count || 0)
          )
          .slice(0, limit)
          .map((p: any) => ({
            _id: p._id,
            questionText: p.questionText,
            subject: p.subject,
            topics: p.topicsCovered || [],
            bloomsLevel: p.bloomLevel || p.bloomsLevel,
            occurrenceCount: p.appearanceFrequency?.count || 1,
            appearances: p.appearanceFrequency?.years?.map((year: number) => ({
              year: year.toString(),
              semester: 'Unknown',
              examType: 'main' as const
            })) || [],
            tags: p.keywords || [],
            similarQuestions: p.similarQuestions || [],
            hasSimilarQuestions: p.hasSimilarQuestions || false
          }));
      }
      
      return NextResponse.json(questions);
    }

    // Search by text
    if (searchText) {
      questions = await uniqueQuestionRepo.searchByText(subject, searchText);
      
      // Fallback to Prompts
      if (!questions || questions.length === 0) {
        console.log('[Unique Questions API] Using Prompts for search');
        const prompts = await promptRepo.findBySubject(subject);
        
        const searchLower = searchText.toLowerCase();
        questions = prompts
          .filter((p: any) => p.questionText?.toLowerCase().includes(searchLower))
          .map((p: any) => ({
            _id: p._id,
            questionText: p.questionText,
            subject: p.subject,
            topics: p.topicsCovered || [],
            bloomsLevel: p.bloomLevel || p.bloomsLevel,
            occurrenceCount: p.appearanceFrequency?.count || 1,
            appearances: p.appearanceFrequency?.years?.map((year: number) => ({
              year: year.toString(),
              semester: 'Unknown',
              examType: 'main' as const
            })) || [],
            tags: p.keywords || [],
            similarQuestions: p.similarQuestions || [],
            hasSimilarQuestions: p.hasSimilarQuestions || false
          }));
      }
      
      return NextResponse.json(questions);
    }

    // Get all unique questions with filters
    const options: any = {};
    if (bloomsLevel) options.bloomsLevel = bloomsLevel;
    if (minOccurrence) options.minOccurrence = parseInt(minOccurrence);
    if (sortBy) options.sortBy = sortBy;
    if (sortOrder) options.sortOrder = sortOrder;

    questions = await uniqueQuestionRepo.findBySubject(subject, options);
    
    // Fallback to Prompts
    if (!questions || questions.length === 0) {
      console.log('[Unique Questions API] Using Prompts for filtered list');
      let prompts = await promptRepo.findBySubject(subject);
      
      // Apply bloom filter
      if (bloomsLevel) {
        prompts = prompts.filter((p: any) => 
          (p.bloomLevel || p.bloomsLevel) === bloomsLevel
        );
      }
      
      // Apply min occurrence filter
      if (minOccurrence) {
        const min = parseInt(minOccurrence);
        prompts = prompts.filter((p: any) => 
          (p.appearanceFrequency?.count || 1) >= min
        );
      }
      
      // Sort
      if (sortBy === 'occurrenceCount') {
        prompts.sort((a: any, b: any) => {
          const aCount = a.appearanceFrequency?.count || 1;
          const bCount = b.appearanceFrequency?.count || 1;
          return sortOrder === 'asc' ? aCount - bCount : bCount - aCount;
        });
      }
      
      questions = prompts.map((p: any) => ({
        _id: p._id,
        questionText: p.questionText,
        subject: p.subject,
        topics: p.topicsCovered || [],
        bloomsLevel: p.bloomLevel || p.bloomsLevel,
        occurrenceCount: p.appearanceFrequency?.count || 1,
        appearances: p.appearanceFrequency?.years?.map((year: number) => ({
          year: year.toString(),
          semester: 'Unknown',
          examType: 'main' as const
        })) || [],
        tags: p.keywords || [],
        similarQuestions: p.similarQuestions || [],
        hasSimilarQuestions: p.hasSimilarQuestions || false
      }));
    }
    
    return NextResponse.json(questions);
  } catch (error: any) {
    console.error("Error fetching unique questions:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch unique questions" },
      { status: 500 }
    );
  }
}
