/**
 * Pure post-processing for the subject summary returned by
 * `AnalysisReportRepository.getSubjectsSummary`.
 *
 * The aggregation already groups by subject name, but the shape is normalised
 * here so callers always get: one row per subject, years sorted newest first,
 * and every branch the subject appears under. Kept dependency free so it can be
 * unit tested with `node --test` (see `tests/node/backend`).
 */

export interface SubjectSummaryRow {
  subjectName: string;
  subjectCode?: string;
  branch?: string;
  branches: string[];
  reportCount: number;
  years: string[];
  latestYear: string;
}

interface RawSubjectSummaryRow {
  subjectName?: unknown;
  subjectCode?: unknown;
  branch?: unknown;
  branches?: unknown;
  reportCount?: unknown;
  years?: unknown;
  latestYear?: unknown;
}

export function sortYearsDescending(years: string[]): string[] {
  return [...new Set(years)].sort((a, b) => {
    const numeric = Number(b) - Number(a);
    if (Number.isFinite(numeric) && numeric !== 0) return numeric;
    return b.localeCompare(a);
  });
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const items = value.filter((item): item is string => typeof item === "string" && item.length > 0);
  return [...new Set(items)];
}

function toCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Normalise aggregation output into the public subject summary contract:
 * - rows without a subject name are dropped,
 * - duplicate subject rows are merged (counts and years summed),
 * - years are newest first and `latestYear` always matches,
 * - `branches` lists every branch for the subject.
 */
export function normalizeSubjectSummaries(rows: RawSubjectSummaryRow[]): SubjectSummaryRow[] {
  const bySubject = new Map<string, SubjectSummaryRow>();

  for (const row of rows ?? []) {
    const subjectName = typeof row?.subjectName === "string" ? row.subjectName.trim() : "";
    if (!subjectName) continue;

    const years = toStringList(row.years);
    const branches = [...new Set([...toStringList(row.branches), ...toStringList(row.branch ? [row.branch] : [])])];
    const subjectCode = typeof row.subjectCode === "string" && row.subjectCode ? row.subjectCode : undefined;
    const branch = branches[0];
    const reportCount = toCount(row.reportCount);
    const latestYear = typeof row.latestYear === "string" && row.latestYear ? row.latestYear : years[0];

    const existing = bySubject.get(subjectName);
    if (!existing) {
      bySubject.set(subjectName, {
        subjectName,
        subjectCode,
        branch,
        branches,
        reportCount,
        years,
        latestYear,
      });
      continue;
    }

    existing.reportCount += reportCount;
    existing.years = [...existing.years, ...years];
    existing.branches = [...new Set([...existing.branches, ...branches])];
    if (!existing.subjectCode && subjectCode) existing.subjectCode = subjectCode;
    if (!existing.branch && branch) existing.branch = branch;
  }

  return [...bySubject.values()]
    .map((subject) => {
      const years = sortYearsDescending(subject.years);
      return { ...subject, years, latestYear: years[0] ?? subject.latestYear };
    })
    .sort((a, b) => a.subjectName.localeCompare(b.subjectName));
}