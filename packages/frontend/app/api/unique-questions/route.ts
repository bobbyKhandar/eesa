import { NextRequest, NextResponse } from "next/server";
import { UniqueQuestionRepository } from "@/backend/src/database/repositories/UniqueQuestionRepository";
import { PromptRepository } from "@/backend/src/database/repositories/PromptRepository";
import { connect } from "@/backend/src/database/connect";
import {
  buildPromptStats,
  parseBoundedInt,
  parseSortField,
  parseSortOrder,
  promptToUniqueQuestion,
  queryPrompts,
  type PromptLike,
  type PromptQueryOptions,
  type UniqueQuestionStatsView,
  type UniqueQuestionView,
} from "@/frontend/lib/subjectQuestionBank";

const uniqueQuestionRepo = new UniqueQuestionRepository();
const promptRepo = new PromptRepository();

export async function GET(request: NextRequest) {
  try {
    await connect();

    const { searchParams } = new URL(request.url);
    const subject = searchParams.get("subject");
    const bloomsLevel = searchParams.get("bloomsLevel");
    const searchText = searchParams.get("search");
    const action = searchParams.get("action"); // "stats" or "frequent"

    // NaN used to reach the Mongo query and throw; unknown sort fields used to be
    // interpolated straight into the sort document.
    const minOccurrence = parseBoundedInt(searchParams.get("minOccurrence"), { min: 1, max: 10_000 });
    const sortBy = parseSortField(searchParams.get("sortBy"));
    const sortOrder = parseSortOrder(searchParams.get("sortOrder"));
    const limit = parseBoundedInt(searchParams.get("limit"), { min: 1, max: 200 }) ?? 10;

    if (!subject) {
      return NextResponse.json(
        { error: "Subject parameter is required" },
        { status: 400 }
      );
    }

    // Try UniqueQuestionRepository first
    let questions: UniqueQuestionView[] = [];

    // Get subject statistics
    if (action === "stats") {
      let stats = (await uniqueQuestionRepo.getSubjectStats(subject)) as
        | UniqueQuestionStatsView
        | null;

      // If no questions in UniqueQuestions, use Prompts as fallback
      if (!stats || stats.totalUniqueQuestions === 0) {
        console.log("[Unique Questions API] UniqueQuestions empty, using Prompts as fallback");
        const prompts = (await promptRepo.findBySubject(subject)) as unknown as PromptLike[];
        stats = buildPromptStats(prompts);
      }

      return NextResponse.json({ withSimilarQuestions: 0, ...stats });
    }

    // Get most frequent questions
    if (action === "frequent") {
      const found = await uniqueQuestionRepo.getMostFrequent(subject, limit);
      questions = (found ?? []) as unknown as UniqueQuestionView[];

      // Fallback to Prompts with highest appearance frequency
      if (questions.length === 0) {
        console.log("[Unique Questions API] Using Prompts for frequent questions");
        const prompts = (await promptRepo.findBySubject(subject)) as unknown as PromptLike[];
        const matches = queryPrompts(prompts, {
          bloomsLevel: bloomsLevel ?? undefined,
          minOccurrence,
          sortBy: "occurrenceCount",
          sortOrder: "desc",
        });

        questions = matches.slice(0, limit).map(promptToUniqueQuestion);
      }

      return NextResponse.json(questions);
    }

    // Search by text
    if (searchText && searchText.trim()) {
      const found = await uniqueQuestionRepo.searchByText(subject, searchText);
      questions = (found ?? []) as unknown as UniqueQuestionView[];

      // Fallback to Prompts. The Bloom filter is applied here too, otherwise a
      // search silently drops an active filter.
      if (questions.length === 0) {
        console.log("[Unique Questions API] Using Prompts for search");
        const prompts = (await promptRepo.findBySubject(subject)) as unknown as PromptLike[];

        const matches = queryPrompts(prompts, {
          bloomsLevel: bloomsLevel ?? undefined,
          minOccurrence,
          search: searchText,
          sortBy,
          sortOrder,
        });

        questions = matches.map(promptToUniqueQuestion);
      }

      return NextResponse.json(questions);
    }

    // Get all unique questions with filters
    const options: Record<string, unknown> = {};
    if (bloomsLevel) options.bloomsLevel = bloomsLevel;
    if (minOccurrence !== undefined) options.minOccurrence = minOccurrence;
    if (sortBy) options.sortBy = sortBy;
    if (sortOrder) options.sortOrder = sortOrder;

    const found = await uniqueQuestionRepo.findBySubject(subject, options as any);
    questions = (found ?? []) as unknown as UniqueQuestionView[];

    // Fallback to Prompts
    if (questions.length === 0) {
      console.log("[Unique Questions API] Using Prompts for filtered list");
      const prompts = (await promptRepo.findBySubject(subject)) as unknown as PromptLike[];

      const queryOptions: PromptQueryOptions = {
        bloomsLevel: bloomsLevel ?? undefined,
        minOccurrence,
        sortBy: sortBy ?? "occurrenceCount",
        sortOrder: sortOrder ?? "desc",
      };

      questions = queryPrompts(prompts, queryOptions).map(promptToUniqueQuestion);
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