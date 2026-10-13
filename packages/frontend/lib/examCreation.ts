export const DEFAULT_EXAM_DURATION_MINUTES = 60;
export const DEFAULT_NEGATIVE_MARKING_PERCENTAGE = 25;
export const MAX_PERCENTAGE = 100;

export interface ExamCreationSettings {
  passingPercentage: unknown;
  duration: unknown;
  negativeMarking: unknown;
  negativeMarkingPercentage: unknown;
}

function isFiniteNumberInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

export function resolveNegativeMarkingPercentage(value: unknown): number {
  return isFiniteNumberInRange(value, 0, MAX_PERCENTAGE) ? value : DEFAULT_NEGATIVE_MARKING_PERCENTAGE;
}

export function resolveDuration(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_EXAM_DURATION_MINUTES;
}

export function computeNegativeMarks(marks: number, negativeMarking: boolean, percentage: unknown): number {
  if (!negativeMarking) return 0;
  return (marks * resolveNegativeMarkingPercentage(percentage)) / 100;
}

export function findInvalidQuestion(questions: unknown): string | null {
  if (!Array.isArray(questions) || questions.length === 0) {
    return "At least one question is required";
  }

  for (let index = 0; index < questions.length; index += 1) {
    const question = questions[index] as { text?: unknown; marks?: unknown } | null;

    if (typeof question?.text !== "string" || question.text.trim().length === 0) {
      return `Question ${index + 1} is missing its text`;
    }

    if (typeof question?.marks !== "number" || !Number.isFinite(question.marks) || question.marks <= 0) {
      return `Question ${index + 1} must have positive marks`;
    }
  }

  return null;
}

export function findInvalidSettings(settings: ExamCreationSettings): string | null {
  if (!isFiniteNumberInRange(settings.passingPercentage, 0, MAX_PERCENTAGE)) {
    return "passingPercentage must be a number between 0 and 100";
  }

  if (settings.duration !== undefined && settings.duration !== null && settings.duration !== "") {
    if (typeof settings.duration !== "number" || !Number.isFinite(settings.duration) || settings.duration <= 0) {
      return "duration must be a positive number of minutes";
    }
  }

  if (settings.negativeMarking === true && !isFiniteNumberInRange(settings.negativeMarkingPercentage, 0, MAX_PERCENTAGE)) {
    return "negativeMarkingPercentage must be a number between 0 and 100 when negative marking is enabled";
  }

  return null;
}

export function normalizeAssignedUsers(examUsers: unknown, creatorId: string): string[] {
  const assigned = new Set<string>();

  if (Array.isArray(examUsers)) {
    for (const candidate of examUsers) {
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        assigned.add(candidate);
      }
    }
  }

  if (typeof creatorId === "string" && creatorId.trim().length > 0) {
    assigned.add(creatorId);
  }

  return Array.from(assigned);
}

export function parseScheduledAt(value: unknown): Date | undefined {
  if (value === undefined || value === null || value === "") return undefined;

  const date = value instanceof Date ? value : new Date(value as string | number);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export interface AssignableStudent {
  id: string;
  name: string;
  email: string;
}

const BLOCKED_STUDENT_STATUSES = new Set(["inactive", "suspended"]);

export const MISSING_STUDENT_ASSIGNEES = "Select at least one student to assign this exam";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * A student who can receive a new exam. Teachers and admins are not recipients.
 * A missing status is treated as active, matching accounts written before the field existed.
 */
export function toAssignableStudent(user: unknown): AssignableStudent | null {
  if (!user || typeof user !== "object") return null;
  const record = user as Record<string, unknown>;
  const id = record._id == null ? "" : String(record._id).trim();
  const email = text(record.email);
  const role = text(record.role);
  const status = text(record.status);
  if (!id || !email || role !== "student") return null;
  if (BLOCKED_STUDENT_STATUSES.has(status)) return null;
  return { id, name: text(record.name) || email, email };
}

export function listAssignableStudents(users: unknown, excludeId?: string): AssignableStudent[] {
  if (!Array.isArray(users)) return [];
  const seen = new Set<string>();
  const students: AssignableStudent[] = [];
  for (const user of users) {
    const row = toAssignableStudent(user);
    if (!row || row.id === excludeId || seen.has(row.id)) continue;
    seen.add(row.id);
    students.push(row);
  }
  return students;
}

export function filterAssignableStudents(students: AssignableStudent[], query: string): AssignableStudent[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return students;
  return students.filter(
    (student) => student.name.toLowerCase().includes(needle) || student.email.toLowerCase().includes(needle),
  );
}

export function dedupeExamUserIds(examUsers: unknown): string[] {
  if (!Array.isArray(examUsers)) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const candidate of examUsers) {
    if (typeof candidate !== "string") continue;
    const id = candidate.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/** Personal exams stay with the creator. Teacher exams submit the chosen students. */
export function examUsersForCreation(examType: unknown, selectedStudentIds: unknown): string[] {
  if (examType !== "teacher") return [];
  return dedupeExamUserIds(selectedStudentIds);
}

export function findMissingStudentAssignees(examType: unknown, studentIds: readonly string[]): string | null {
  if (examType !== "teacher") return null;
  return studentIds.length === 0 ? MISSING_STUDENT_ASSIGNEES : null;
}

/**
 * Intersect the requested ids with active student accounts.
 * The creator is always stored separately and is not a recipient here.
 */
export function confirmedStudentAssignees(
  requestedIds: readonly string[],
  directory: readonly unknown[],
  creatorId: string,
): string[] {
  const allowed = new Set(listAssignableStudents(directory).map((student) => student.id));
  return dedupeExamUserIds(requestedIds).filter((id) => id !== creatorId && allowed.has(id));
}
