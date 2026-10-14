/**
 * Resource library catalog helpers — dependency-free.
 *
 * Backs `GET /api/resources?action=subjects|pyqs` and the `/resources` page.
 *
 * The route used to bucket subjects with `s.semester || "Semester 1"` even
 * though `AnalysisReportRepository.getSubjectsSummary()` never returned a
 * `semester` field, so *every* subject in the database was filed under
 * "Semester 1" and the semester picker only ever offered that one value. It
 * also read `s.code` and `s.uniqueQuestionCount`, fields the summary does not
 * have, so `code` was always undefined and `questionCount` always 0.
 */

export const DEFAULT_BRANCH_LABEL = "General";

/** Bucket for a subject whose stored record carries no semester. */
export const DEFAULT_SEMESTER_LABEL = "General";

export interface SubjectReportRow {
  subjectName?: string | null;
  name?: string | null;
  subjectCode?: string | null;
  code?: string | null;
  branch?: string | null;
  semester?: string | null;
  reportCount?: number | null;
}

export interface CatalogSubject {
  id: string;
  name: string;
  code: string;
  branch: string;
  /** Every semester this subject has a published report for. */
  semesters: string[];
  reportCount: number;
  questionCount: number;
}

export interface SubjectCatalog {
  subjects: CatalogSubject[];
  branches: string[];
  semesters: string[];
  /** branch -> semester -> subject names available in that slot. */
  grouped: Record<string, Record<string, string[]>>;
  /** Distinct subject names, i.e. subjects offered across all branches. */
  uniqueSubjectCount: number;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Compare labels so embedded numbers order naturally.
 *
 * `Array.prototype.sort()` on the labels put "Semester 10" before
 * "Semester 2" because "1" < "2" character-wise. Digits are compared as
 * numbers and everything else with a locale-aware comparison, so "S2" < "S10"
 * and "Semester 3" < "Semester 11".
 */
export function naturalCompare(a: string, b: string): number {
  const chunks = /(\d+)|(\D+)/g;
  const left = a.match(chunks) ?? [];
  const right = b.match(chunks) ?? [];

  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const l = left[index];
    const r = right[index];

    if (l === undefined) return -1;
    if (r === undefined) return 1;

    const lNum = /^\d/.test(l);
    const rNum = /^\d/.test(r);

    if (lNum && rNum) {
      const diff = Number(l) - Number(r);
      if (diff !== 0) return diff;
      continue;
    }

    const diff = l.localeCompare(r, undefined, { numeric: true, sensitivity: "base" });
    if (diff !== 0) return diff;
  }

  return 0;
}

export function sortLabels(labels: Iterable<string>): string[] {
  return Array.from(new Set(labels)).sort(naturalCompare);
}

/**
 * Turn the flat report rows into the branch -> semester -> subject index the
 * `/resources` filter needs.
 *
 * `questionCounts` maps a subject name to its active UniqueQuestions count; the
 * route used to invent that number with `Math.random()`.
 */
export function buildSubjectCatalog(
  rows: readonly SubjectReportRow[],
  questionCounts: Readonly<Record<string, number>> = {}
): SubjectCatalog {
  const subjects = new Map<string, CatalogSubject>();
  const grouped: Record<string, Record<string, string[]>> = {};
  const branchLabels = new Set<string>();
  const semesterLabels = new Set<string>();
  const names = new Set<string>();

  for (const row of rows) {
    const name = text(row.subjectName) || text(row.name);
    if (!name) continue;

    const branch = text(row.branch) || DEFAULT_BRANCH_LABEL;
    const semester = text(row.semester) || DEFAULT_SEMESTER_LABEL;
    const code = text(row.subjectCode) || text(row.code);
    const key = JSON.stringify([branch, code, name]);

    let subject = subjects.get(key);
    if (!subject) {
      subject = {
        id: key,
        name,
        code,
        branch,
        semesters: [],
        reportCount: 0,
        questionCount: count(questionCounts[name]),
      };
      subjects.set(key, subject);
    }

    subject.reportCount += count(row.reportCount);
    if (!subject.semesters.includes(semester)) {
      subject.semesters.push(semester);
    }

    if (!grouped[branch]) {
      grouped[branch] = {};
    }
    const bucket = grouped[branch][semester] ?? (grouped[branch][semester] = []);
    if (!bucket.includes(name)) {
      bucket.push(name);
    }

    branchLabels.add(branch);
    semesterLabels.add(semester);
    names.add(name);
  }

  for (const subject of subjects.values()) {
    subject.semesters.sort(naturalCompare);
  }
  for (const semesters of Object.values(grouped)) {
    for (const bucket of Object.values(semesters)) {
      bucket.sort(naturalCompare);
    }
  }

  return {
    subjects: Array.from(subjects.values()),
    branches: sortLabels(branchLabels),
    semesters: sortLabels(semesterLabels),
    grouped,
    uniqueSubjectCount: names.size,
  };
}

export interface ResourceSelection {
  branch: string;
  semester: string;
  subject: string;
}

export const EMPTY_SELECTION: ResourceSelection = { branch: "", semester: "", subject: "" };

/**
 * Changing the branch invalidates the semester and the subject: both are scoped
 * to a branch. The page used to keep them, so switching branch left a subject
 * from another branch selected and the header then claimed it belonged to the
 * new branch.
 */
export function selectBranch(selection: ResourceSelection, branch: string): ResourceSelection {
  if (branch === selection.branch) return selection;
  return { branch, semester: "", subject: "" };
}

/** Changing the semester invalidates the subject. */
export function selectSemester(selection: ResourceSelection, semester: string): ResourceSelection {
  if (semester === selection.semester) return selection;
  return { branch: selection.branch, semester, subject: "" };
}

/** Drop any part of the selection the loaded catalog no longer offers. */
export function reconcileSelection(
  selection: ResourceSelection,
  catalog: Pick<SubjectCatalog, "branches" | "grouped"> | null | undefined
): ResourceSelection {
  if (!catalog) return selection;

  const { branch, semester, subject } = selection;
  if (!branch) return EMPTY_SELECTION;
  if (!catalog.branches.includes(branch)) return EMPTY_SELECTION;

  const semesters = catalog.grouped[branch] ?? {};
  if (!semester) return { branch, semester: "", subject: "" };
  if (!semesters[semester]) return { branch, semester: "", subject: "" };

  const subjects = semesters[semester] ?? [];
  if (!subject || !subjects.includes(subject)) {
    return { branch, semester, subject: "" };
  }

  return selection;
}

/**
 * A short, human-readable label for a PYQ row.
 *
 * The route built it as `q.text?.substring(0, 50) + "..." || fallback`, and
 * `undefined + "..."` is the truthy string `"undefined..."`, so a question with
 * no text was titled `undefined...` instead of falling back.
 */
export function questionTitle(text: unknown, fallback: string, maxLength = 50): string {
  const source = typeof text === "string" ? text.trim() : "";
  if (!source) return fallback;
  if (source.length <= maxLength) return source;
  return `${source.slice(0, maxLength).trimEnd()}...`;
}

export interface PyqStatsInput {
  /** Distinct questions stored for the subject. */
  uniqueQuestions: number;
  /** How many times those questions appeared across published papers. */
  totalOccurrences: number;
  avgOccurrence: number;
  bloomsDistribution: Record<string, number>;
  /** Distinct subjects represented in the returned rows. */
  subjectCount: number;
}

export interface PyqStats {
  /** Every PYQ entry the subject has, i.e. one per appearance. */
  totalQuestions: number;
  uniqueQuestions: number;
  totalOccurrences: number;
  avgOccurrence: number;
  bloomsDistribution: Record<string, number>;
  subjectCount: number;
}

function nonNegativeInt(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

/**
 * Normalise the `stats` block of the PYQ payload.
 *
 * The page reads `stats.uniqueQuestions` and `stats.subjectCount`, which the
 * route never returned, so "Unique Questions" fell back to the row count and
 * "Subjects Covered" fell back to the total number of subjects in the whole
 * catalogue — the same number whichever subject was selected.
 */
export function buildPyqStats(input: PyqStatsInput): PyqStats {
  const totalOccurrences = nonNegativeInt(input.totalOccurrences);

  return {
    totalQuestions: totalOccurrences,
    uniqueQuestions: nonNegativeInt(input.uniqueQuestions),
    totalOccurrences,
    avgOccurrence: Number.isFinite(input.avgOccurrence) ? Math.round(input.avgOccurrence * 10) / 10 : 0,
    bloomsDistribution: input.bloomsDistribution ?? {},
    subjectCount: nonNegativeInt(input.subjectCount),
  };
}

/** Difficulty label shown on a PYQ row. Unknown Bloom levels stay Medium. */
export function difficultyFromBlooms(bloomsLevel: unknown): string {
  const level = typeof bloomsLevel === "string" ? bloomsLevel.toLowerCase() : "";
  switch (level) {
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

export interface ResourcePyq {
  _id: string;
  id: string;
  title: string;
  questionText: string;
  year: string;
  years: string[];
  examType: string;
  occurrenceCount: number;
  frequency: number;
  bloomsLevel: string;
  topic: string;
  topics: string[];
  difficulty: string;
  downloadCount: number;
  sourceReports: number;
  firstSeenAt?: unknown;
  lastSeenAt?: unknown;
}

export interface FallbackPyqContext {
  years: readonly string[];
  examType?: string;
  reportCount?: number;
  firstSeenAt?: unknown;
  lastSeenAt?: unknown;
}

function readField(source: object, key: string): unknown {
  return (source as { [key: string]: unknown })[key];
}

function rowId(value: unknown, index: number): string {
  if (typeof value === "string" && value.length > 0) return value;
  if (value && typeof value === "object" && "toString" in value) {
    const text = String(value);
    if (text && text !== "[object Object]") return text;
  }
  return `q-${index + 1}`;
}

function appearanceYears(appearances: unknown): string[] {
  if (!Array.isArray(appearances)) return [];
  return Array.from(
    new Set(
      appearances
        .map((appearance) => {
          if (!appearance || typeof appearance !== "object") return "";
          const year = (appearance as { year?: unknown }).year;
          return typeof year === "string" ? year : "";
        })
        .filter((year) => year.length > 0),
    ),
  ).sort();
}

function firstAppearanceExamType(appearances: unknown): string {
  if (!Array.isArray(appearances) || !appearances[0] || typeof appearances[0] !== "object") {
    return "main";
  }
  const examType = (appearances[0] as { examType?: unknown }).examType;
  return typeof examType === "string" && examType.length > 0 ? examType : "main";
}

function positiveCount(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Shape one stored unique question the way the resources table reads it.
 * The returned row is a fresh object, so an embedding on the source stays there.
 */
export function mapStoredQuestionToPyq(question: object, index: number, subject: string): ResourcePyq {
  const storedText = readField(question, "text") ?? readField(question, "questionText");
  const questionText = typeof storedText === "string" ? storedText : "";
  const years = appearanceYears(readField(question, "appearances"));
  const bloomsLevel = readField(question, "bloomsLevel");
  const topicValue = readField(question, "topic");
  const topic = typeof topicValue === "string" && topicValue.length > 0 ? topicValue : subject;
  const occurrence = positiveCount(readField(question, "occurrenceCount"), 1);
  const sourceReports = readField(question, "sourceReports");
  const id = rowId(readField(question, "_id"), index);

  return {
    _id: id,
    id,
    title: questionTitle(storedText, `Question ${index + 1}`),
    questionText,
    year: years[0] ?? "",
    years,
    examType: firstAppearanceExamType(readField(question, "appearances")),
    occurrenceCount: occurrence,
    frequency: occurrence,
    bloomsLevel: typeof bloomsLevel === "string" && bloomsLevel.length > 0 ? bloomsLevel : "understand",
    topic,
    topics: typeof topicValue === "string" && topicValue.length > 0 ? [topicValue] : [subject],
    difficulty: difficultyFromBlooms(bloomsLevel),
    downloadCount: 0,
    sourceReports: Array.isArray(sourceReports) && sourceReports.length > 0 ? sourceReports.length : 1,
    firstSeenAt: readField(question, "firstSeenAt"),
    lastSeenAt: readField(question, "lastSeenAt"),
  };
}

/**
 * Shape one fallback prompt. Years, exam type, and report count come from the
 * subject summary so a page of prompts does not recompute them.
 */
export function mapFallbackPromptToPyq(
  prompt: object,
  index: number,
  subject: string,
  context: FallbackPyqContext,
): ResourcePyq {
  const primary = readField(prompt, "questionText");
  const alternate = readField(prompt, "text");
  const questionText =
    (typeof primary === "string" && primary.length > 0 ? primary : "") ||
    (typeof alternate === "string" ? alternate : "");
  const bloomsLevel = readField(prompt, "bloomsLevel");
  const topicValue = readField(prompt, "topic");
  const topic = typeof topicValue === "string" && topicValue.length > 0 ? topicValue : subject;
  const years = context.years.filter((year) => year.length > 0);
  const id = rowId(readField(prompt, "_id"), index);

  return {
    _id: id,
    id,
    title: questionTitle(primary ?? alternate, `Question ${index + 1}`),
    questionText,
    year: years[0] ?? "2024",
    years,
    examType: context.examType && context.examType.length > 0 ? context.examType : "main",
    occurrenceCount: 1,
    frequency: 1,
    bloomsLevel: typeof bloomsLevel === "string" && bloomsLevel.length > 0 ? bloomsLevel : "understand",
    topic,
    topics: typeof topicValue === "string" && topicValue.length > 0 ? [topicValue] : [subject],
    difficulty: difficultyFromBlooms(bloomsLevel),
    downloadCount: 0,
    sourceReports: typeof context.reportCount === "number" && context.reportCount > 0 ? context.reportCount : 1,
    firstSeenAt: context.firstSeenAt,
    lastSeenAt: context.lastSeenAt,
  };
}
