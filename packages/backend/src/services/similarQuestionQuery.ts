/**
 * Similarity filter for prompts stored through promptZodSchema.
 *
 * Those documents omit isActive and normalizedText. A missing isActive counts
 * as active (`isActive != false`). Matching uses questionText, which the
 * schema does store. Publication filtering of generateVia "user" exam drafts
 * stays on the public question bank and is not part of this filter.
 */

export interface SimilarQuestionsFilter {
  subject: string;
  isActive: { $ne: false };
  excludedIds: string[];
  questionText?: { $regex: string; $options: "i" };
}

export interface StoredPromptCandidate {
  _id?: unknown;
  questionText?: unknown;
  subject?: unknown;
  isActive?: unknown;
}

function normalizeQuestionText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractKeywords(text: string, minLength: number = 4): string[] {
  const words = text.split(/\s+/);
  const stopWords = new Set([
    "what",
    "how",
    "why",
    "when",
    "where",
    "which",
    "who",
    "explain",
    "describe",
    "define",
    "with",
  ]);

  return words
    .filter((word) => word.length >= minLength && !stopWords.has(word))
    .slice(0, 10);
}

export function buildSimilarQuestionsFilter(
  questionText: string,
  subject: string,
  excludeIds: string[] = []
): SimilarQuestionsFilter {
  const keywords = extractKeywords(normalizeQuestionText(questionText));
  const keywordPattern = keywords.join("|");

  const filter: SimilarQuestionsFilter = {
    subject,
    isActive: { $ne: false },
    excludedIds: excludeIds,
  };

  if (keywordPattern) {
    filter.questionText = { $regex: keywordPattern, $options: "i" };
  }

  return filter;
}

/**
 * In-memory equivalent of the Mongo filter. Missing isActive matches;
 * isActive false does not. questionText is compared with the keyword regex.
 */
export function promptMatchesSimilarQuestionSearch(
  prompt: StoredPromptCandidate,
  questionText: string,
  subject: string,
  excludeIds: string[] = []
): boolean {
  const filter = buildSimilarQuestionsFilter(questionText, subject, excludeIds);
  if (prompt.subject !== filter.subject) return false;
  if (prompt.isActive === false) return false;

  const id = prompt._id == null ? "" : String(prompt._id);
  if (filter.excludedIds.includes(id)) return false;

  if (filter.questionText) {
    const flags = filter.questionText.$options.includes("i") ? "i" : "";
    if (!new RegExp(filter.questionText.$regex, flags).test(String(prompt.questionText ?? ""))) {
      return false;
    }
  }

  return true;
}
