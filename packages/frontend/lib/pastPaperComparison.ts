/**
 * Bloom-distribution comparison for a single exam analysis.
 *
 * The PastPaper collection is never written, and this upload does not create
 * prompts, so question-similarity links are not a comparison. The numbers
 * below come only from the same user's completed or published exam analyses
 * whose subject name matches.
 */

const BLOOM_LEVELS = [
  "Recall",
  "Understand",
  "Apply",
  "Analyze",
  "Evaluate",
  "Create",
] as const;

type BloomLevel = (typeof BLOOM_LEVELS)[number];
type BloomDistribution = Record<BloomLevel, number>;

const COMPARABLE_STATUSES = new Set(["completed", "published"]);
const CLOSE_SHIFT = 10;
const LARGE_SHIFT = 25;
const TREND_SHIFT = 5;

export interface EarlierAnalysis {
  id: string;
  subjectName: string;
  year?: string;
  status?: string;
  totalQuestions?: number;
  bloomDistribution?: unknown;
}

export interface StoredPastPaperComparison {
  status: string;
  detail: string;
  deviation?: number;
  trends: string[];
  tone: "success" | "warning" | "error" | "neutral";
}

export interface PastPaperComparisonOutcome {
  pastPaperComparison: StoredPastPaperComparison;
  comparedAnalysisIds: string[];
}

function emptyDistribution(): BloomDistribution {
  return {
    Recall: 0,
    Understand: 0,
    Apply: 0,
    Analyze: 0,
    Evaluate: 0,
    Create: 0,
  };
}

function sanitizeDistribution(value: unknown): BloomDistribution {
  const source =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const safe = emptyDistribution();

  for (const level of BLOOM_LEVELS) {
    const entry = source[level];
    safe[level] =
      typeof entry === "number" && Number.isFinite(entry)
        ? Math.min(100, Math.max(0, entry))
        : 0;
  }

  return safe;
}

function subjectKey(name: string): string {
  return name.trim().toLowerCase();
}

function roundPercent(value: number): number {
  return Math.round(value);
}

function roundShift(value: number): number {
  return Math.round(value * 10) / 10;
}

export function pastPaperComparisonBadge(
  deviation: number | undefined,
): string {
  return typeof deviation === "number" ? `${deviation} pp` : "No history";
}

function noneFound(): PastPaperComparisonOutcome {
  return {
    pastPaperComparison: {
      status: "No earlier analyses",
      detail: "No earlier completed analysis of this subject was found.",
      trends: [],
      tone: "neutral",
    },
    comparedAnalysisIds: [],
  };
}

function comparisonStatus(deviation: number): {
  status: string;
  tone: StoredPastPaperComparison["tone"];
} {
  if (deviation < CLOSE_SHIFT) {
    return { status: "Close to earlier analyses", tone: "success" };
  }
  if (deviation < LARGE_SHIFT) {
    return { status: "Some difference from earlier analyses", tone: "warning" };
  }
  return { status: "Large difference from earlier analyses", tone: "error" };
}

export function compareBloomWithEarlierAnalyses(input: {
  currentId: string;
  subjectName: string;
  bloomDistribution: unknown;
  earlierAnalyses: EarlierAnalysis[];
}): PastPaperComparisonOutcome {
  const subject = subjectKey(input.subjectName);
  const selected = input.earlierAnalyses.filter((analysis) => {
    if (analysis.id === input.currentId) return false;
    if (subjectKey(analysis.subjectName) !== subject) return false;
    if (!analysis.status || !COMPARABLE_STATUSES.has(analysis.status))
      return false;
    if (analysis.totalQuestions === 0) return false;
    return true;
  });

  if (selected.length === 0) return noneFound();

  const current = sanitizeDistribution(input.bloomDistribution);
  const averages = emptyDistribution();
  for (const analysis of selected) {
    const distribution = sanitizeDistribution(analysis.bloomDistribution);
    for (const level of BLOOM_LEVELS) {
      averages[level] += distribution[level];
    }
  }
  for (const level of BLOOM_LEVELS) {
    averages[level] /= selected.length;
  }

  let largestLevel: BloomLevel = BLOOM_LEVELS[0];
  let largestShift = 0;
  const trends: string[] = [];

  for (const level of BLOOM_LEVELS) {
    const shift = Math.abs(current[level] - averages[level]);
    if (shift > largestShift) {
      largestShift = shift;
      largestLevel = level;
    }
    if (shift >= TREND_SHIFT) {
      trends.push(
        `${level} is ${roundPercent(current[level])}% on this exam and ${roundPercent(averages[level])}% on earlier analyses.`,
      );
    }
  }

  const years = [
    ...new Set(
      selected
        .map((analysis) => analysis.year)
        .filter((year): year is string => Boolean(year)),
    ),
  ].sort();
  const yearClause = years.length > 0 ? ` (${years.join(", ")})` : "";
  const noun = selected.length === 1 ? "analysis" : "analyses";
  const deviation = roundShift(largestShift);
  const { status, tone } = comparisonStatus(deviation);

  return {
    pastPaperComparison: {
      status,
      detail: `Compared with ${selected.length} earlier completed ${noun} of this subject${yearClause}. Largest shift is ${largestLevel}: ${roundPercent(current[largestLevel])}% on this exam and ${roundPercent(averages[largestLevel])}% on those analyses.`,
      deviation,
      trends,
      tone,
    },
    comparedAnalysisIds: selected.map((analysis) => analysis.id),
  };
}
