/**
 * Pure, dependency-free helpers shared by the exam analysis and publish
 * services: Bloom's taxonomy normalisation, question-text normalisation for
 * deduplication, and Prompt payload construction.
 *
 * Intentionally a leaf module (no internal imports) so the logic can be unit
 * tested directly with Node's test runner.
 */

export const BLOOM_LEVELS = [
  "Recall",
  "Understand",
  "Apply",
  "Analyze",
  "Evaluate",
  "Create",
] as const;

export type BloomLevel = (typeof BLOOM_LEVELS)[number];

export type BloomDistribution = Record<BloomLevel, number>;

/** Casing accepted by the Prompt / UniqueQuestion schemas. */
export type PromptBloomLevel =
  | "remember"
  | "understand"
  | "apply"
  | "analyze"
  | "evaluate"
  | "create";

export interface BloomDistributionInput {
  marks?: number | null;
  bloomLevel?: string | null;
}

const BLOOM_LEVEL_ALIASES: Record<string, BloomLevel> = {
  recall: "Recall",
  remember: "Recall",
  knowledge: "Recall",
  understand: "Understand",
  comprehension: "Understand",
  apply: "Apply",
  application: "Apply",
  analyze: "Analyze",
  analysis: "Analyze",
  evaluate: "Evaluate",
  evaluation: "Evaluate",
  create: "Create",
  creation: "Create",
};

export function emptyBloomDistribution(): BloomDistribution {
  return {
    Recall: 0,
    Understand: 0,
    Apply: 0,
    Analyze: 0,
    Evaluate: 0,
    Create: 0,
  };
}

/**
 * Normalizes an AI-supplied Bloom label (e.g. "remember", "ANALYZE") to the
 * canonical taxonomy casing used by the schemas. Returns null when the label is
 * not recognisable, so callers can decide how to handle it instead of silently
 * creating bogus distribution buckets.
 */
export function normalizeBloomLevel(value?: string | null): BloomLevel | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase();
  if (!key) return null;
  return BLOOM_LEVEL_ALIASES[key] ?? null;
}

/**
 * Normalizes question text for deduplication.
 * Removes punctuation, collapses whitespace and lowercases.
 */
export function normalizeQuestionText(text?: string | null): string {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Converts a Bloom level to the casing used by the Prompt/UniqueQuestion
 * collections.
 *
 * The schemas' enum uses `remember` rather than `recall` for the first level,
 * so this mapping cannot simply lowercase the label. Falls back to
 * "understand" for unknown levels.
 */
const BLOOM_LEVEL_TO_PROMPT_FORMAT: Record<BloomLevel, PromptBloomLevel> = {
  Recall: "remember",
  Understand: "understand",
  Apply: "apply",
  Analyze: "analyze",
  Evaluate: "evaluate",
  Create: "create",
};

export function mapBloomLevelToPromptFormat(
  value?: string | null
): PromptBloomLevel {
  const level = normalizeBloomLevel(value);
  return level ? BLOOM_LEVEL_TO_PROMPT_FORMAT[level] : "understand";
}

/**
 * Calculates the Bloom distribution as a share of total marks.
 *
 * Guards:
 *  - unknown/blank bloom levels are ignored rather than creating new buckets
 *  - non-finite or negative marks are treated as 0
 *  - when the exam carries no marks at all, falls back to an even split across
 *    the questions so the distribution never becomes NaN/Infinity
 */
export function calculateBloomDistribution(
  questions: BloomDistributionInput[]
): BloomDistribution {
  return roundBloomDistribution(computeBloomDistribution(questions));
}

function computeBloomDistribution(
  questions: BloomDistributionInput[]
): BloomDistribution {
  const distribution = emptyBloomDistribution();

  const scored = questions
    .map((question) => ({
      level: normalizeBloomLevel(question?.bloomLevel),
      marks: Number.isFinite(question?.marks as number)
        ? Math.max(0, question?.marks as number)
        : 0,
    }))
    .filter((entry): entry is { level: BloomLevel; marks: number } => entry.level !== null);

  if (scored.length === 0) return distribution;

  const totalMarks = scored.reduce((sum, entry) => sum + entry.marks, 0);

  if (totalMarks <= 0) {
    // No usable mark data: distribute evenly so percentages still sum to 100.
    const evenShare = 100 / scored.length;
    for (const entry of scored) {
      distribution[entry.level] += evenShare;
    }
    return distribution;
  }

  for (const entry of scored) {
    distribution[entry.level] += (entry.marks / totalMarks) * 100;
  }

  return distribution;
}

/**
 * Coerces an arbitrary/partial distribution into a fully-numeric one that
 * satisfies the schema's per-level `min(0).max(100)` constraints.
 * Missing, null, non-numeric or out-of-range values become 0.
 */
export function sanitizeBloomDistribution(
  distribution: Partial<BloomDistribution> | null | undefined
): BloomDistribution {
  const safe = emptyBloomDistribution();
  if (!distribution || typeof distribution !== "object") return safe;

  for (const level of BLOOM_LEVELS) {
    const value = (distribution as Record<string, unknown>)[level];
    safe[level] =
      typeof value === "number" && Number.isFinite(value)
        ? Math.min(100, Math.max(0, value))
        : 0;
  }

  return safe;
}

/**
 * Rounds a distribution so the persisted values are free of float noise.
 */
export function roundBloomDistribution(distribution: BloomDistribution): BloomDistribution {
  const rounded = emptyBloomDistribution();
  for (const level of BLOOM_LEVELS) {
    rounded[level] = Math.round((distribution[level] ?? 0) * 100) / 100;
  }
  return rounded;
}

export interface AnalyzedQuestionInput {
  questionText?: string | null;
  keywords?: unknown;
  confidence?: number | null;
  bloomLevel?: string | null;
}

export interface PromptPayload {
  questionText: string;
  subject: string;
  topic?: string;
  generateVia: "ocr";
  source?: string;
  ocrConfidence?: number;
  bloomsLevel: PromptBloomLevel;
}

export interface CreatedPrompt<T> {
  question: T;
  promptId: string;
}

export interface PromptCreateResult {
  success?: boolean;
  promptId?: string;
  error?: string;
}

/**
 * Builds the Prompt payload for a question, or null when the question has no
 * usable text (which previously produced orphan prompt rows and silently
 * misaligned every following prompt ID).
 */
export function buildPromptPayload<T extends AnalyzedQuestionInput>(
  question: T,
  context: { subject?: string; source?: string }
): PromptPayload | null {
  const questionText = String(question?.questionText ?? "").trim();
  const subject = context.subject?.trim();
  if (!questionText || !subject) return null;

  const keywords = Array.isArray(question?.keywords)
    ? question.keywords.filter(
        (keyword): keyword is string =>
          typeof keyword === "string" && keyword.length > 0
      )
    : [];

  const confidence =
    typeof question?.confidence === "number" && Number.isFinite(question.confidence)
      ? question.confidence
      : undefined;

  return {
    questionText,
    subject,
    topic: keywords.length > 0 ? keywords.join(", ") : undefined,
    generateVia: "ocr",
    source: context.source,
    ocrConfidence: confidence,
    bloomsLevel: mapBloomLevelToPromptFormat(question?.bloomLevel),
  };
}

/**
 * Appends a successfully created prompt together with the question it came
 * from. Returns a new array; a failed result leaves the list untouched so a
 * report's `questionIds` can never drift away from their questions.
 */
export function appendCreatedPrompt<T>(
  created: CreatedPrompt<T>[],
  question: T,
  result: PromptCreateResult
): CreatedPrompt<T>[] {
  if (!result?.success || !result.promptId) return created;
  return [...created, { question, promptId: result.promptId }];
}
