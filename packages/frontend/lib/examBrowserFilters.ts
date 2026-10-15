/**
 * Pure derivations for the student exam browser (`/exams`).
 *
 * The category chips and quick-action buttons used to render without state or
 * handlers, so clicking them could never filter or navigate anywhere. These
 * helpers keep that wiring testable without a browser. The page has no
 * difficulty field on its exam payload, so there is intentionally no
 * difficulty filter here.
 */

export const EXAM_CATEGORIES = [
  "Computer Science",
  "Data Science",
  "Web Development",
  "Programming",
  "Mathematics",
  "Physics",
] as const;

export type ExamCategory = (typeof EXAM_CATEGORIES)[number];

export interface ExamBrowserFields {
  title?: unknown;
  description?: unknown;
  subject?: unknown;
  degree?: unknown;
  type?: unknown;
}

export interface SortableBrowserExam extends ExamBrowserFields {
  duration?: unknown;
  questions?: unknown;
  assignedUsers?: unknown;
  createdAt?: unknown;
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function timeOf(value: unknown): number {
  const time = new Date(textOf(value)).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function numberOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * A null/empty/"All" category matches everything. Otherwise the exam matches
 * when any descriptive field (subject, type, title, description, degree)
 * contains the category, case-insensitively.
 */
export function matchesCategory(exam: ExamBrowserFields | null | undefined, category: string | null | undefined): boolean {
  if (!category || category === "All") return true;
  const needle = category.trim().toLowerCase();
  if (!needle) return true;
  const haystacks = [exam?.subject, exam?.type, exam?.title, exam?.description, exam?.degree];
  return haystacks.some((value) => textOf(value).toLowerCase().includes(needle));
}

export function filterExamsByCategory<T extends ExamBrowserFields>(
  exams: readonly T[],
  category: string | null | undefined,
): T[] {
  if (!Array.isArray(exams)) return [];
  return exams.filter((exam) => matchesCategory(exam, category));
}

/** Clicking the active chip clears the filter; clicking another chip selects it. */
export function toggleCategory(current: string | null, next: string): string | null {
  return current === next ? null : next;
}

export type ExamBrowserSort = "recent" | "alphabetical" | "duration" | "popular";

/**
 * Sort helper shared by the page and its tests. "popular" orders by enrolled
 * users (falling back to question count) because `/api/exams/list` only serves
 * allocated exams and exposes no other popularity signal.
 */
export function sortBrowserExams<T extends SortableBrowserExam>(
  exams: readonly T[],
  sortBy: string,
): T[] {
  const rows = Array.isArray(exams) ? [...exams] : [];
  if (sortBy === "alphabetical") {
    return rows.sort((a, b) => textOf(a?.title).localeCompare(textOf(b?.title)));
  }
  if (sortBy === "duration") {
    return rows.sort((a, b) => numberOf(a?.duration) - numberOf(b?.duration));
  }
  if (sortBy === "popular") {
    return rows.sort((a, b) => {
      const users = numberOf(b?.assignedUsers) - numberOf(a?.assignedUsers);
      if (users !== 0) return users;
      const questions = numberOf(b?.questions) - numberOf(a?.questions);
      if (questions !== 0) return questions;
      return timeOf(b?.createdAt) - timeOf(a?.createdAt);
    });
  }
  return rows.sort((a, b) => timeOf(b?.createdAt) - timeOf(a?.createdAt));
}
