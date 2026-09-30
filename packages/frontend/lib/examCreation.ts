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
