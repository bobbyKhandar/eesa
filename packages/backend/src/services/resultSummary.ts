/**
 * Summary metrics for a user's whole graded history, computed in one aggregation.
 *
 * The numeric rules match `packages/frontend/lib/examResults.ts`:
 * percentage is rounded half away from zero for the averages, while the grade
 * and the pass verdict use the unrounded percentage. A missing exam uses the
 * same fallbacks as `buildResultRow` (subject "General", pass mark 40).
 * `tests/node/results-history.test.ts` keeps the two copies aligned.
 */

export const RESULT_GRADE_CUTOFFS: ReadonlyArray<readonly [number, string]> = [
  [90, "A+"],
  [80, "A"],
  [70, "B+"],
  [60, "B"],
  [50, "C+"],
  [40, "C"],
];

export const RESULT_DEFAULT_PASSING_PERCENTAGE = 40;
export const RESULT_SUBJECT_FALLBACK = "General";

export interface UserResultSummaryAggregate {
  totalExams: number;
  passedExams: number;
  roundedScoreSum: number;
  highestScore: number;
  grades: Array<{ grade: string; count: number }>;
  subjects: Array<{ subject: string; total: number; count: number }>;
  months: Array<{ key: string; total: number; count: number }>;
}

export interface StoredResultMetricsInput {
  marksAchieved?: unknown;
  maxMarks?: unknown;
  passingPercentage?: unknown;
  subject?: unknown;
  submittedAt?: unknown;
}

export interface StoredResultMetrics {
  roundedPercentage: number;
  grade: string;
  passed: boolean;
  subject: string;
  monthKey: string | null;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** `Math.round`, which the aggregation writes as `$floor(raw + 0.5)`. */
export function roundPercentage(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value);
}

function rawPercentage(marksAchieved: unknown, maxMarks: unknown): number {
  const total = finiteNumber(maxMarks);
  const achieved = finiteNumber(marksAchieved) ?? 0;
  if (total === null || total <= 0) return 0;
  const percentage = (achieved / total) * 100;
  return Number.isFinite(percentage) ? percentage : 0;
}

function passingPercentage(value: unknown): number {
  const parsed = finiteNumber(value);
  if (parsed === null) return RESULT_DEFAULT_PASSING_PERCENTAGE;
  return Math.min(100, Math.max(0, parsed));
}

function subjectName(value: unknown): string {
  if (typeof value === "string" && value.trim() !== "") return value;
  return RESULT_SUBJECT_FALLBACK;
}

export function gradeForPercentage(percentage: number): string {
  for (const [cutoff, grade] of RESULT_GRADE_CUTOFFS) {
    if (percentage >= cutoff) return grade;
  }
  return "F";
}

function monthKeyOf(value: unknown): string | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** In-process twin of the aggregation expressions, used to lock the rules together. */
export function deriveStoredResultMetrics(input: StoredResultMetricsInput): StoredResultMetrics {
  const raw = rawPercentage(input.marksAchieved, input.maxMarks);
  const threshold = passingPercentage(input.passingPercentage);
  return {
    roundedPercentage: roundPercentage(raw),
    grade: gradeForPercentage(raw),
    passed: raw >= threshold,
    subject: subjectName(input.subject),
    monthKey: monthKeyOf(input.submittedAt),
  };
}

export function emptyUserResultSummary(): UserResultSummaryAggregate {
  return {
    totalExams: 0,
    passedExams: 0,
    roundedScoreSum: 0,
    highestScore: 0,
    grades: [],
    subjects: [],
    months: [],
  };
}

function countOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readGroups(value: unknown): Array<{ label: string; total: number; count: number }> {
  if (!Array.isArray(value)) return [];
  const groups: Array<{ label: string; total: number; count: number }> = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as { _id?: unknown; total?: unknown; count?: unknown };
    if (typeof record._id !== "string" || record._id.length === 0) continue;
    groups.push({
      label: record._id,
      total: countOf(record.total),
      count: countOf(record.count),
    });
  }
  return groups;
}

/** Map the `$facet` document (or a one-element array of it) into plain numbers. */
export function readSummaryAggregate(raw: unknown): UserResultSummaryAggregate {
  const facet = Array.isArray(raw) ? raw[0] : raw;
  if (!facet || typeof facet !== "object") return emptyUserResultSummary();

  const record = facet as {
    stats?: unknown;
    grades?: unknown;
    subjects?: unknown;
    months?: unknown;
  };
  const statsRow = Array.isArray(record.stats) ? record.stats[0] : null;
  const stats =
    statsRow && typeof statsRow === "object"
      ? (statsRow as {
          totalExams?: unknown;
          passedExams?: unknown;
          roundedScoreSum?: unknown;
          highestScore?: unknown;
        })
      : null;

  const totalExams = countOf(stats?.totalExams);
  if (totalExams === 0) return emptyUserResultSummary();

  return {
    totalExams,
    passedExams: countOf(stats?.passedExams),
    roundedScoreSum: countOf(stats?.roundedScoreSum),
    highestScore: countOf(stats?.highestScore),
    grades: readGroups(record.grades).map((group) => ({
      grade: group.label,
      count: group.count,
    })),
    subjects: readGroups(record.subjects).map((group) => ({
      subject: group.label,
      total: group.total,
      count: group.count,
    })),
    months: readGroups(record.months).map((group) => ({
      key: group.label,
      total: group.total,
      count: group.count,
    })),
  };
}

function subjectExpression(): Record<string, unknown> {
  return {
    $cond: [
      { $eq: [{ $type: "$examDoc.subject" }, "string"] },
      {
        $cond: [
          { $gt: [{ $strLenCP: { $trim: { input: "$examDoc.subject" } } }, 0] },
          "$examDoc.subject",
          RESULT_SUBJECT_FALLBACK,
        ],
      },
      RESULT_SUBJECT_FALLBACK,
    ],
  };
}

function passingExpression(): Record<string, unknown> {
  return {
    $let: {
      vars: {
        rawPass: {
          $cond: [
            {
              $and: [
                { $isNumber: "$examDoc.passingPercentage" },
                { $eq: ["$examDoc.passingPercentage", "$examDoc.passingPercentage"] },
              ],
            },
            "$examDoc.passingPercentage",
            RESULT_DEFAULT_PASSING_PERCENTAGE,
          ],
        },
      },
      in: { $min: [100, { $max: [0, "$$rawPass"] }] },
    },
  };
}

function gradeExpression(): Record<string, unknown> {
  return {
    $switch: {
      branches: RESULT_GRADE_CUTOFFS.map(([cutoff, grade]) => ({
        case: { $gte: ["$rawPercentage", cutoff] },
        then: grade,
      })),
      default: "F",
    },
  };
}

/**
 * One aggregation over every graded submission for `match`.
 * It does not `$limit`: the page query is separate. Responses are dropped
 * before the exam join so the pipeline does not carry answer text.
 */
export function buildUserResultSummaryPipeline(
  match: Record<string, unknown>,
  examCollection: string,
): Record<string, unknown>[] {
  return [
    { $match: match },
    {
      $project: {
        submittedAt: 1,
        marksAchieved: 1,
        maxMarks: 1,
        examId: 1,
      },
    },
    {
      $lookup: {
        from: examCollection,
        let: { examId: "$examId" },
        pipeline: [
          {
            $match: {
              $expr: {
                $eq: [{ $toString: "$_id" }, { $toString: "$$examId" }],
              },
            },
          },
          { $project: { subject: 1, passingPercentage: 1 } },
        ],
        as: "exam",
      },
    },
    { $addFields: { examDoc: { $arrayElemAt: ["$exam", 0] } } },
    {
      $addFields: {
        rawPercentage: {
          $let: {
            vars: {
              total: "$maxMarks",
              achieved: {
                $cond: [{ $isNumber: "$marksAchieved" }, "$marksAchieved", 0],
              },
            },
            in: {
              $cond: [
                {
                  $and: [{ $isNumber: "$$total" }, { $gt: ["$$total", 0] }],
                },
                { $multiply: [{ $divide: ["$$achieved", "$$total"] }, 100] },
                0,
              ],
            },
          },
        },
        passingPercentage: passingExpression(),
        subject: subjectExpression(),
        monthKey: {
          $cond: [
            { $eq: [{ $type: "$submittedAt" }, "date"] },
            {
              $dateToString: {
                format: "%Y-%m",
                date: "$submittedAt",
                timezone: "UTC",
              },
            },
            null,
          ],
        },
      },
    },
    {
      $addFields: {
        roundedPercentage: { $floor: { $add: ["$rawPercentage", 0.5] } },
        grade: gradeExpression(),
        passed: { $gte: ["$rawPercentage", "$passingPercentage"] },
      },
    },
    {
      $facet: {
        stats: [
          {
            $group: {
              _id: null,
              totalExams: { $sum: 1 },
              passedExams: { $sum: { $cond: ["$passed", 1, 0] } },
              roundedScoreSum: { $sum: "$roundedPercentage" },
              highestScore: { $max: "$roundedPercentage" },
            },
          },
        ],
        grades: [{ $group: { _id: "$grade", count: { $sum: 1 } } }],
        subjects: [
          {
            $group: {
              _id: "$subject",
              total: { $sum: "$roundedPercentage" },
              count: { $sum: 1 },
            },
          },
        ],
        months: [
          { $match: { monthKey: { $type: "string" } } },
          {
            $group: {
              _id: "$monthKey",
              total: { $sum: "$roundedPercentage" },
              count: { $sum: 1 },
            },
          },
        ],
      },
    },
  ];
}
