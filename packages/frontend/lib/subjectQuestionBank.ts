/**
 * Pure helpers shared by the subject question-bank UI and its API routes.
 *
 * Everything in this module is side-effect free and dependency free so it can be
 * unit tested directly with `node --test` (see `tests/node/frontend`).
 */

/* -------------------------------------------------------------------------- */
/* Query parameter parsing                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Escape a user supplied string so it can be used as a literal inside a
 * Mongo `$regex` filter. Without this, searching for "(" throws a BSONError and
 * searching for ".*" scans the whole collection.
 */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Parse an integer query parameter. Returns `undefined` for missing values and
 * `undefined` for anything that is not a finite integer, so callers never feed
 * `NaN` into a Mongo query (which would throw at query time).
 */
export function parseBoundedInt(
  raw: string | null | undefined,
  options: { min?: number; max?: number } = {}
): number | undefined {
  if (raw === null || raw === undefined) return undefined;

  const trimmed = String(raw).trim();
  if (!trimmed || !/^-?\d+$/.test(trimmed)) return undefined;

  const value = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(value)) return undefined;

  const { min, max } = options;
  if (typeof min === "number" && value < min) return undefined;
  if (typeof max === "number" && value > max) return undefined;

  return value;
}

const SORT_FIELDS = ["occurrenceCount", "firstSeenAt", "lastSeenAt"] as const;
export type UniqueQuestionSortField = (typeof SORT_FIELDS)[number];
export type SortOrder = "asc" | "desc";

export function parseSortField(raw: string | null | undefined): UniqueQuestionSortField | undefined {
  if (!raw) return undefined;
  return (SORT_FIELDS as readonly string[]).includes(raw)
    ? (raw as UniqueQuestionSortField)
    : undefined;
}

export function parseSortOrder(raw: string | null | undefined): SortOrder | undefined {
  return raw === "asc" || raw === "desc" ? raw : undefined;
}

/* -------------------------------------------------------------------------- */
/* Bloom's taxonomy                                                            */
/* -------------------------------------------------------------------------- */

export const BLOOM_LABELS = [
  "Recall",
  "Understand",
  "Apply",
  "Analyze",
  "Evaluate",
  "Create",
] as const;

export type BloomLabel = (typeof BLOOM_LABELS)[number];

export type BloomDistribution = Record<BloomLabel, number>;

/** Legacy lowercase spelling stored on prompts / unique questions. */
export type PromptBloomLevel =
  | "remember"
  | "understand"
  | "apply"
  | "analyze"
  | "evaluate"
  | "create";

const LABEL_BY_PROMPT_BLOOM: Record<PromptBloomLevel, BloomLabel> = {
  remember: "Recall",
  understand: "Understand",
  apply: "Apply",
  analyze: "Analyze",
  evaluate: "Evaluate",
  create: "Create",
};

/**
 * Every spelling that appears in the codebase mapped to the prompt format.
 * "Recall"/"Remember" are aliases, and the pipeline emits both "Analyze" and
 * the British "Analyse".
 */
const PROMPT_BLOOM_BY_SPELLING: Record<string, PromptBloomLevel> = {
  recall: "remember",
  remember: "remember",
  understand: "understand",
  apply: "apply",
  analyze: "analyze",
  analyse: "analyze",
  evaluate: "evaluate",
  create: "create",
};

/**
 * Normalise either Bloom spelling ("Recall" / "remember") to the lowercase
 * prompt format. Returns `null` when the value is not a known level, so callers
 * can treat legacy rows with junk values as "no bloom data" instead of silently
 * matching everything.
 */
export function normalizeBloomLevel(raw: unknown): PromptBloomLevel | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim().toLowerCase();
  return PROMPT_BLOOM_BY_SPELLING[key] ?? null;
}

/** Convert any Bloom spelling to its canonical display label. */
export function bloomLabel(raw: unknown): BloomLabel | null {
  const level = normalizeBloomLevel(raw);
  return level ? LABEL_BY_PROMPT_BLOOM[level] : null;
}

/** Convert a pipeline Bloom level to the lowercase prompt format. */
export function toPromptBloomLevel(raw: unknown): PromptBloomLevel {
  return normalizeBloomLevel(raw) ?? "understand";
}

/** Convert a lowercase prompt level back to the display label. */
export function toBloomLabel(raw: unknown): BloomLabel | null {
  const level = normalizeBloomLevel(raw);
  return level ? LABEL_BY_PROMPT_BLOOM[level] : null;
}

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
 * Convert a list of Bloom levels (either spelling) into percentages that sum to
 * 100. `AnalysisReport.bloomDistribution` is validated as `0..100` percentages,
 * so persisting raw question counts silently corrupts the report and fails
 * validation once a paper has more than 100 questions at one level.
 *
 * Rounding is applied to the last non-zero bucket so the total stays at 100.
 */
export function toBloomPercentages(levels: unknown[]): BloomDistribution {
  const counts = emptyBloomDistribution();
  let total = 0;

  for (const raw of levels) {
    const label = bloomLabel(raw);
    if (!label) continue;
    counts[label] += 1;
    total += 1;
  }

  const distribution = emptyBloomDistribution();
  if (total === 0) return distribution;

  const populated = BLOOM_LABELS.filter((label) => counts[label] > 0);
  let assigned = 0;

  populated.forEach((label, index) => {
    if (index === populated.length - 1) {
      // Absorb the rounding drift of the previous buckets so the total is 100.
      distribution[label] = Math.max(0, Math.round((100 - assigned) * 10) / 10);
      return;
    }
    distribution[label] = Math.round((counts[label] / total) * 1000) / 10;
    assigned += distribution[label];
  });

  return distribution;
}

/* -------------------------------------------------------------------------- */
/* Prompt -> unique question projection                                        */
/* -------------------------------------------------------------------------- */

export interface PromptAppearanceFrequency {
  count: number;
  years?: number[];
}

export interface PromptLike {
  _id?: unknown;
  questionText?: string;
  subject?: string;
  subjectCode?: string;
  bloomLevel?: string;
  bloomsLevel?: string;
  appearanceFrequency?: PromptAppearanceFrequency;
  topicsCovered?: string[];
  keywords?: string[];
  similarQuestions?: unknown[];
  hasSimilarQuestions?: boolean;
  createdAt?: string | Date;
  [key: string]: unknown;
}

export interface UniqueQuestionAppearance {
  year: string;
  semester: string;
  examType: "main" | "kt";
  analysisReportId?: string;
}

export interface UniqueQuestionView {
  _id: string;
  questionText: string;
  normalizedText: string;
  subject: string;
  topics: string[];
  bloomsLevel: PromptBloomLevel;
  occurrenceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  appearances: UniqueQuestionAppearance[];
  tags: string[];
  similarQuestions: unknown[];
  hasSimilarQuestions: boolean;
}

export function normalizeQuestionText(text: unknown): string {
  if (typeof text !== "string") return "";
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Prompts predate the UniqueQuestions collection and are used as a fallback
 * source. Project one into the same shape the subject page expects, including
 * the `firstSeenAt` / `lastSeenAt` fields it renders directly.
 */
export function promptToUniqueQuestion(prompt: PromptLike): UniqueQuestionView {
  const questionText = typeof prompt.questionText === "string" ? prompt.questionText : "";
  const bloom = normalizeBloomLevel(prompt.bloomsLevel ?? prompt.bloomLevel);
  const createdAt = toIsoString(prompt.createdAt);
  const years = prompt.appearanceFrequency?.years;

  return {
    _id: String(prompt._id ?? ""),
    questionText,
    normalizedText: normalizeQuestionText(questionText),
    subject: typeof prompt.subject === "string" ? prompt.subject : "",
    topics: toStringArray(prompt.topicsCovered),
    bloomsLevel: bloom ?? "understand",
    occurrenceCount: toOccurrenceCount(prompt.appearanceFrequency),
    firstSeenAt: createdAt,
    lastSeenAt: createdAt,
    appearances: Array.isArray(years)
      ? years.map((year) => ({
          year: String(year),
          semester: "Unknown",
          examType: "main" as const,
        }))
      : [],
    tags: toStringArray(prompt.keywords),
    similarQuestions: Array.isArray(prompt.similarQuestions) ? prompt.similarQuestions : [],
    hasSimilarQuestions: prompt.hasSimilarQuestions === true,
  };
}

export function promptsToUniqueQuestions(prompts: PromptLike[]): UniqueQuestionView[] {
  return prompts.map(promptToUniqueQuestion);
}

/** Bloom level as stored on a prompt, whichever field holds it. */
export function promptBloomLevel(prompt: PromptLike): PromptBloomLevel | null {
  return normalizeBloomLevel(prompt.bloomsLevel ?? prompt.bloomLevel);
}

export function promptOccurrenceCount(prompt: PromptLike): number {
  return toOccurrenceCount(prompt.appearanceFrequency);
}

/* -------------------------------------------------------------------------- */
/* Prompt fallback querying                                                    */
/* -------------------------------------------------------------------------- */

export interface PromptQueryOptions {
  bloomsLevel?: string;
  minOccurrence?: number;
  search?: string;
  sortBy?: UniqueQuestionSortField;
  sortOrder?: SortOrder;
}

/**
 * Filter / sort prompts before they are projected into unique questions.
 *
 * Bloom comparison is normalised so the UI's lowercase filter values match the
 * capitalised `bloomLevel` written by the upload pipeline.
 */
export function queryPrompts(
  prompts: PromptLike[],
  options: PromptQueryOptions
): PromptLike[] {
  let result = [...prompts];

  const bloom = normalizeBloomLevel(options.bloomsLevel);
  if (bloom) {
    result = result.filter((prompt) => promptBloomLevel(prompt) === bloom);
  }

  if (typeof options.minOccurrence === "number" && options.minOccurrence > 0) {
    result = result.filter((prompt) => promptOccurrenceCount(prompt) >= options.minOccurrence!);
  }

  const search = typeof options.search === "string" ? options.search.trim().toLowerCase() : "";
  if (search) {
    result = result.filter((prompt) =>
      typeof prompt.questionText === "string"
        ? prompt.questionText.toLowerCase().includes(search)
        : false
    );
  }

  const sortBy = options.sortBy;
  const direction = options.sortOrder === "asc" ? 1 : -1;
  if (sortBy) {
    result.sort((a, b) => compareBySortField(a, b, sortBy) * direction);
  }

  return result;
}

function compareBySortField(
  a: PromptLike,
  b: PromptLike,
  field: UniqueQuestionSortField
): number {
  if (field === "occurrenceCount") {
    return promptOccurrenceCount(a) - promptOccurrenceCount(b);
  }

  const aTime = toTimestamp(a[field]);
  const bTime = toTimestamp(b[field]);
  return aTime - bTime;
}

export interface UniqueQuestionStatsView {
  totalUniqueQuestions: number;
  totalOccurrences: number;
  avgOccurrence: number;
  bloomsDistribution: Record<string, number>;
  withSimilarQuestions: number;
}

/**
 * Stats derived from prompts. `avgOccurrence` must use `appearanceFrequency.count`
 * (how many papers the question showed up in), not a hard coded 1, otherwise the
 * "Avg. Repetitions" card is always wrong on the fallback path.
 */
export function buildPromptStats(prompts: PromptLike[]): UniqueQuestionStatsView {
  const bloomsDistribution: Record<string, number> = {};
  let totalOccurrences = 0;

  for (const prompt of prompts) {
    const bloom = promptBloomLevel(prompt);
    const key = bloom ?? "unknown";
    bloomsDistribution[key] = (bloomsDistribution[key] || 0) + 1;
    totalOccurrences += promptOccurrenceCount(prompt);
  }

  return {
    totalUniqueQuestions: prompts.length,
    totalOccurrences,
    avgOccurrence: prompts.length === 0 ? 0 : Math.round((totalOccurrences / prompts.length) * 10) / 10,
    bloomsDistribution,
    withSimilarQuestions: prompts.filter((prompt) => prompt.hasSimilarQuestions === true).length,
  };
}

/* -------------------------------------------------------------------------- */
/* Subject documents                                                           */
/* -------------------------------------------------------------------------- */

const SUBJECT_CODE_PATTERN = /^[A-Z]{2}\d{3}$/;

export type SubjectYear = "FY" | "SY" | "TY" | "LY";

/** First academic year per cycle; anything else falls back to the current one. */
export const ACADEMIC_YEAR_STARTS: Record<string, SubjectYear> = {
  "2021": "FY",
  "2022": "SY",
  "2023": "TY",
  "2024": "LY",
  "2025": "FY",
  "2026": "SY",
  "2027": "TY",
  "2028": "LY",
};

/**
 * Subject codes must match `^[A-Z]{2}\d{3}$`. Pipelines emit "cs 205",
 * "CS-205", "205" and similar, all of which are rejected by the schema, so
 * normalise before saving. Returns `null` when nothing usable can be derived.
 */
export function normalizeSubjectCode(rawCode: unknown, subjectName: unknown = ""): string | null {
  const candidate = String(rawCode ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

  if (SUBJECT_CODE_PATTERN.test(candidate)) return candidate;

  const letters = subjectCodeLetters(candidate, subjectName);
  if (letters.length < 2) return null;

  const fromName = String(subjectName ?? "").toUpperCase();
  const digits = `${candidate.replace(/[^0-9]/g, "")}${fromName.replace(/[^0-9]/g, "")}`;
  if (digits.length < 3) return null;

  return `${letters}${digits.padEnd(3, "0").slice(0, 3)}`;
}

/**
 * Two leading letters for a code: whatever the pipeline gave us, otherwise the
 * initials of the first two words of the subject name, otherwise its first two
 * letters.
 */
function subjectCodeLetters(candidate: string, subjectName: unknown): string {
  const candidateLetters = candidate.replace(/[^A-Z]/g, "");
  if (candidateLetters.length >= 2) return candidateLetters.slice(0, 2);

  const words = String(subjectName ?? "")
    .split(/[^A-Za-z]+/)
    .filter(Boolean);

  if (words.length >= 2) {
    return `${words[0][0]}${words[1][0]}`.toUpperCase();
  }

  const nameLetters = words.join("").toUpperCase().replace(/[^A-Z]/g, "");
  return nameLetters.slice(0, 2);
}

export function normalizeExamType(raw: unknown): "main" | "kt" {
  return String(raw ?? "").trim().toLowerCase() === "kt" ? "kt" : "main";
}

export function normalizeSubjectYear(raw: unknown, fallback: SubjectYear = "SY"): SubjectYear {
  const key = String(raw ?? "").trim();
  return ACADEMIC_YEAR_STARTS[key] ?? fallback;
}

export interface AutoSubjectDocument {
  name: string;
  code: string;
  branch: string;
  year: SubjectYear;
  semester: string;
  credits: number;
  type: "Core";
  description: string;
  duration: string;
  isActive: boolean;
  topics: string[];
  learningOutcomes: string[];
  assessmentStructure: string[];
  textbooks: string[];
  references: string[];
  createdBy: string;
  metadata: Record<string, unknown>;
}

/**
 * Build the document for a subject auto-created from an OCR upload job.
 * Returns `null` when the subject name or a schema-valid code is missing, so
 * callers can skip instead of writing a document that always fails validation.
 */
export function buildAutoSubjectDocument(input: {
  subjectName: unknown;
  subjectCode: unknown;
  branch?: unknown;
  year?: unknown;
  semester?: unknown;
  jobId: string;
  createdBy?: string;
}): AutoSubjectDocument | null {
  const name = typeof input.subjectName === "string" ? input.subjectName.trim() : "";
  if (!name) return null;

  const code = normalizeSubjectCode(input.subjectCode, name);
  if (!code) return null;

  return {
    name,
    code,
    branch: (typeof input.branch === "string" && input.branch.trim()) || "CSE",
    year: normalizeSubjectYear(input.year),
    semester: `Semester ${String(input.semester ?? "1").trim() || "1"}`,
    credits: 4,
    type: "Core",
    description: `Auto-generated from OCR pipeline - ${name}`,
    duration: "16 weeks",
    isActive: true,
    topics: [],
    learningOutcomes: [],
    assessmentStructure: [],
    textbooks: [],
    references: [],
    createdBy: input.createdBy || "ai-pipeline",
    metadata: {
      autoCreated: true,
      source: "ai-pipeline-ocr",
      createdFrom: input.jobId,
      createdAt: new Date().toISOString(),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Route param + API payload guards                                            */
/* -------------------------------------------------------------------------- */

/**
 * Next.js already URL-decodes dynamic route params. Decoding again throws a
 * URIError for names containing a literal "%" (e.g. "100% Java"), so decoding
 * is best-effort only.
 */
export function safeDecodeParam(value: string | undefined | null): string {
  if (typeof value !== "string" || value.length === 0) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Only accept the list shape; API errors return `{ error: string }`. */
export function toUniqueQuestionList(data: unknown): UniqueQuestionView[] {
  return Array.isArray(data) ? (data as UniqueQuestionView[]) : [];
}

/**
 * Importing a finished pipeline job writes subjects, prompts and reports.
 * Only an admin may trigger that. Anyone else, including a signed-out caller,
 * is refused. The page guard on `/admin` does not cover this route.
 */
export function canImportFromJob(role: unknown): boolean {
  return role === "admin";
}

export function toUniqueQuestionStats(data: unknown): UniqueQuestionStatsView | null {
  if (!isRecord(data)) return null;
  if (typeof data.totalUniqueQuestions !== "number") return null;

  return {
    totalUniqueQuestions: data.totalUniqueQuestions,
    totalOccurrences: typeof data.totalOccurrences === "number" ? data.totalOccurrences : 0,
    avgOccurrence: typeof data.avgOccurrence === "number" ? data.avgOccurrence : 0,
    bloomsDistribution: isRecord(data.bloomsDistribution)
      ? (data.bloomsDistribution as Record<string, number>)
      : {},
    withSimilarQuestions: typeof data.withSimilarQuestions === "number" ? data.withSimilarQuestions : 0,
  };
}

/* -------------------------------------------------------------------------- */
/* internals                                                                   */
/* -------------------------------------------------------------------------- */

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function toOccurrenceCount(frequency: PromptAppearanceFrequency | undefined): number {
  const count = frequency?.count;
  if (typeof count !== "number" || !Number.isFinite(count) || count < 1) return 1;
  return Math.floor(count);
}

function toIsoString(value: unknown): string {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? new Date().toISOString() : value.toISOString();
  }
  if (typeof value === "string" && value) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
  }
  return new Date().toISOString();
}

function toTimestamp(value: unknown): number {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? 0 : time;
  }
  if (typeof value === "string" && value) {
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? 0 : time;
  }
  return 0;
}