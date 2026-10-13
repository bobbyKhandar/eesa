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

export const EXAM_QUESTION_TYPES = ["TEXT", "MCQ", "TRUE_FALSE"] as const;
export type ExamQuestionType = (typeof EXAM_QUESTION_TYPES)[number];
export type AuthoringKind = "theory" | "mcq" | "true_false";

export const MCQ_CHOICE_COUNT = 4;
export const TRUE_FALSE_OPTIONS = ["True", "False"] as const;

const QUESTION_TYPE_ALIASES: Record<string, ExamQuestionType> = {
  text: "TEXT",
  theory: "TEXT",
  essay: "TEXT",
  mcq: "MCQ",
  multiple_choice: "MCQ",
  true_false: "TRUE_FALSE",
  truefalse: "TRUE_FALSE",
  true_or_false: "TRUE_FALSE",
};

export interface ExamQuestionDraft {
  id: number;
  type: AuthoringKind;
  text: string;
  marks: number;
  questionType: ExamQuestionType;
  answer: string;
  options?: string[];
  correctOption?: number;
}

export function normalizeExamQuestionType(value: unknown): ExamQuestionType | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!key) return null;
  return QUESTION_TYPE_ALIASES[key] ?? null;
}

function hasTypeValue(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  return value != null;
}

/**
 * Client drafts store the schema type on `questionType` and an authoring kind
 * on `type`. The create API receives the schema type as `type`. A missing type
 * stays a theory question, matching exams written before type selection.
 */
export function authoredQuestionType(question: unknown): ExamQuestionType | null {
  if (!question || typeof question !== "object") return null;
  const record = question as Record<string, unknown>;
  const raw = hasTypeValue(record.questionType)
    ? record.questionType
    : hasTypeValue(record.type)
      ? record.type
      : undefined;
  if (raw === undefined) return "TEXT";
  return normalizeExamQuestionType(raw);
}

export function authoringKind(value: unknown): AuthoringKind | null {
  const type = normalizeExamQuestionType(value);
  if (type === "TEXT") return "theory";
  if (type === "MCQ") return "mcq";
  if (type === "TRUE_FALSE") return "true_false";
  return null;
}

export function nextQuestionId(questions: readonly { id: number }[]): number {
  if (questions.length === 0) return 1;
  return Math.max(...questions.map((question) => question.id)) + 1;
}

export function createQuestionDraft(kind: AuthoringKind, id: number): ExamQuestionDraft {
  if (kind === "mcq") {
    return {
      id,
      type: "mcq",
      text: "",
      marks: 5,
      questionType: "MCQ",
      answer: "",
      options: Array.from({ length: MCQ_CHOICE_COUNT }, () => ""),
    };
  }

  if (kind === "true_false") {
    return {
      id,
      type: "true_false",
      text: "",
      marks: 1,
      questionType: "TRUE_FALSE",
      answer: "",
      options: [...TRUE_FALSE_OPTIONS],
    };
  }

  return {
    id,
    type: "theory",
    text: "",
    marks: 10,
    questionType: "TEXT",
    answer: "",
  };
}

export function withQuestionType(question: ExamQuestionDraft, nextType: ExamQuestionType): ExamQuestionDraft {
  const shared = {
    id: question.id,
    text: question.text,
    marks: question.marks,
    answer: question.answer ?? "",
  };

  if (nextType === "MCQ") {
    const keep =
      question.questionType === "MCQ" && Array.isArray(question.options) && question.options.length >= 2;
    return {
      ...shared,
      type: "mcq",
      questionType: "MCQ",
      options: keep ? [...question.options!] : Array.from({ length: MCQ_CHOICE_COUNT }, () => ""),
      correctOption: keep ? question.correctOption : undefined,
    };
  }

  if (nextType === "TRUE_FALSE") {
    const keep = question.questionType === "TRUE_FALSE" && (question.correctOption === 0 || question.correctOption === 1);
    return {
      ...shared,
      type: "true_false",
      questionType: "TRUE_FALSE",
      options: [...TRUE_FALSE_OPTIONS],
      correctOption: keep ? question.correctOption : undefined,
    };
  }

  return {
    ...shared,
    type: "theory",
    questionType: "TEXT",
  };
}

export function replaceChoice(options: readonly string[], index: number, text: string): string[] {
  return options.map((option, optionIndex) => (optionIndex === index ? text : option));
}

export function appendChoice(options: readonly string[]): string[] {
  return [...options, ""];
}

export function removeChoice(
  options: readonly string[],
  index: number,
  correctOption?: number,
): { options: string[]; correctOption?: number } {
  if (options.length <= 2 || index < 0 || index >= options.length) {
    return { options: [...options], correctOption };
  }

  const next = options.filter((_, optionIndex) => optionIndex !== index);
  if (correctOption === undefined) return { options: next };
  if (correctOption === index) return { options: next, correctOption: undefined };
  if (correctOption > index) return { options: next, correctOption: correctOption - 1 };
  return { options: next, correctOption };
}

/** Drop objective fields when a draft is theory so a type switch cannot submit stale choices. */
export function mergeQuestionUpdate(question: ExamQuestionDraft, patch: Partial<ExamQuestionDraft>): ExamQuestionDraft {
  const next: ExamQuestionDraft = { ...question, ...patch };
  if (next.questionType !== "TEXT") return next;
  return {
    id: next.id,
    type: "theory",
    text: next.text,
    marks: next.marks,
    questionType: "TEXT",
    answer: next.answer ?? "",
  };
}

export function toCreateExamQuestions(questions: readonly ExamQuestionDraft[]): Array<{
  text: string;
  marks: number;
  type: ExamQuestionType;
  answer: string;
  options?: string[];
  correctOption?: number;
}> {
  return questions.map((question) => {
    const payload = {
      text: question.text,
      marks: question.marks,
      type: question.questionType,
      answer: question.answer ?? "",
    };
    if (question.questionType === "TEXT") return payload;
    return {
      ...payload,
      options: question.options ?? [],
      correctOption: question.correctOption,
    };
  });
}

function choiceList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.map((item) => (typeof item === "string" ? item : ""));
}

function findTypeSpecificError(
  question: Record<string, unknown>,
  questionType: ExamQuestionType,
  label: string,
): string | null {
  if (questionType === "TEXT") return null;

  if (questionType === "TRUE_FALSE") {
    const options = choiceList(question.options);
    const normalized = options?.map((option) => option.trim().toLowerCase()) ?? [];
    if (normalized.length !== 2 || normalized[0] !== "true" || normalized[1] !== "false") {
      return `${label} must offer True and False`;
    }
    if (question.correctOption !== 0 && question.correctOption !== 1) {
      return `${label} needs a correct answer`;
    }
    return null;
  }

  const options = choiceList(question.options);
  if (!options || options.length < 2) {
    return `${label} needs at least two choices`;
  }
  if (options.some((option) => option.trim().length === 0)) {
    return `${label} has an empty choice`;
  }

  const seen = new Set<string>();
  for (const option of options) {
    const key = option.trim().toLowerCase();
    if (seen.has(key)) return `${label} has duplicate choices`;
    seen.add(key);
  }

  const correctOption = question.correctOption;
  if (typeof correctOption !== "number" || !Number.isInteger(correctOption) || correctOption < 0 || correctOption >= options.length) {
    return `${label} needs a correct choice`;
  }

  return null;
}

export function findInvalidQuestion(questions: unknown): string | null {
  if (!Array.isArray(questions) || questions.length === 0) {
    return "At least one question is required";
  }

  for (let index = 0; index < questions.length; index += 1) {
    const question = questions[index] as { text?: unknown; marks?: unknown } | null;
    const label = `Question ${index + 1}`;

    if (typeof question?.text !== "string" || question.text.trim().length === 0) {
      return `${label} is missing its text`;
    }

    if (typeof question?.marks !== "number" || !Number.isFinite(question.marks) || question.marks <= 0) {
      return `${label} must have positive marks`;
    }

    const questionType = authoredQuestionType(question);
    if (!questionType) {
      return `${label} has an unsupported type`;
    }

    const typeError = findTypeSpecificError(question as Record<string, unknown>, questionType, label);
    if (typeError) return typeError;
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
