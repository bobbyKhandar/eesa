import { createHash } from "node:crypto";
import { examQuestionZodSchema } from "./schemas/examQuestionSchemaZod.js";

/**
 * Maps a legacy exam's embedded `{ questionId, marks }` entries onto the
 * ExamQuestion schema. Already-migrated exams (an array of ExamQuestion ids)
 * are skipped so a re-run does not rewrite assignees, createdBy, or deletedAt.
 * Failed exams produce no update. ExamQuestion ids are derived from the exam
 * id and the legacy question id, so a retry upserts the same documents.
 */

const DEFAULT_NEGATIVE_MARKING_PERCENTAGE = 25;
const ABSENT_ANSWER = "NOT PRESENT";

export interface LegacyQuestionSource {
  text?: unknown;
  answer?: unknown;
  questionAnswer?: unknown;
  options?: unknown;
  questionOptions?: unknown;
  type?: unknown;
  questionType?: unknown;
  answerType?: unknown;
  marks?: unknown;
}

export interface PromptLink {
  promptId: string;
  question: LegacyQuestionSource;
}

export interface MappedExamQuestion {
  promptId: string;
  questionType: "MCQ" | "TEXT" | "TRUE_FALSE";
  marks: number;
  negativeMarks: number;
  options?: Array<{ text: string; isCorrect: boolean }>;
  answer: unknown;
}

export interface ExamQuestionWrite {
  id: string;
  data: MappedExamQuestion;
}

export interface ExamConversionPlan {
  status: "skip-empty" | "skip-migrated" | "failed" | "convert";
  error?: string;
  questions?: ExamQuestionWrite[];
  examUpdate?: { questions: string[] };
}

export interface MigrationFailure {
  step: string;
  id: string;
  error: string;
}

interface OptionDraft {
  text: string;
  isCorrect?: boolean;
}

export function documentId(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (!value || typeof value !== "object") return "";

  const record = value as { toHexString?: unknown; toString?: unknown };
  if (typeof record.toHexString === "function") {
    const hex = String(record.toHexString.call(value));
    return hex === "[object Object]" ? "" : hex;
  }
  if (typeof record.toString === "function" && record.toString !== Object.prototype.toString) {
    const text = String(record.toString.call(value));
    return text === "[object Object]" ? "" : text;
  }
  return "";
}

export function legacyQuestionSource(question: object): LegacyQuestionSource {
  const record = question as Record<string, unknown>;
  return {
    text: record.text ?? record.questionText,
    answer: record.answer,
    questionAnswer: record.questionAnswer,
    options: record.options,
    questionOptions: record.questionOptions,
    type: record.type,
    questionType: record.questionType,
    answerType: record.answerType,
    marks: record.marks,
  };
}

export function migratedExamQuestionId(examId: string, legacyQuestionId: string, index: number): string {
  return createHash("sha256")
    .update(`eesa:exam-question:${examId}:${legacyQuestionId}:${index}`)
    .digest("hex")
    .slice(0, 24);
}

export function migratedQuestionMarks(marks: unknown): number {
  if (typeof marks === "number" && Number.isFinite(marks)) return marks;
  if (typeof marks === "string" && marks.trim() !== "") {
    const parsed = Number(marks);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 1;
}

export function negativeMarksForMigratedQuestion(
  marks: number,
  negativeMarking: unknown,
  negativeMarkingPercentage: unknown
): number {
  if (negativeMarking !== true) return 0;
  const percentage =
    typeof negativeMarkingPercentage === "number" &&
    Number.isFinite(negativeMarkingPercentage) &&
    negativeMarkingPercentage >= 0 &&
    negativeMarkingPercentage <= 100
      ? negativeMarkingPercentage
      : DEFAULT_NEGATIVE_MARKING_PERCENTAGE;
  return (marks * percentage) / 100;
}

export function mapLegacyQuestionType(
  type: unknown,
  hasOptions: boolean
): "MCQ" | "TEXT" | "TRUE_FALSE" | null {
  const normalized = String(type ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]/g, "_");

  if (!normalized) return hasOptions ? "MCQ" : "TEXT";
  if (normalized === "mcq" || normalized === "multiple_select" || normalized === "multiple_choice") {
    return "MCQ";
  }
  if (normalized === "true_false" || normalized === "truefalse" || normalized === "tf" || normalized === "boolean") {
    return "TRUE_FALSE";
  }
  if (
    normalized === "theory" ||
    normalized === "text" ||
    normalized === "short" ||
    normalized === "long" ||
    normalized === "numerical" ||
    normalized === "diagram" ||
    normalized === "essay" ||
    normalized === "subjective"
  ) {
    return "TEXT";
  }
  return null;
}

function readOptions(value: unknown): OptionDraft[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((option) => {
    if (typeof option === "string") return { text: option };
    if (option && typeof option === "object") {
      const record = option as { text?: unknown; isCorrect?: unknown };
      const text = typeof record.text === "string" ? record.text : String(record.text ?? "");
      return typeof record.isCorrect === "boolean" ? { text, isCorrect: record.isCorrect } : { text };
    }
    return { text: String(option ?? "") };
  });
}

function chooseOptions(
  legacyQuestion: LegacyQuestionSource | null | undefined,
  embedded: Record<string, unknown> | null | undefined
): OptionDraft[] {
  const fromQuestion = readOptions(legacyQuestion?.options ?? legacyQuestion?.questionOptions);
  const fromEmbedded = readOptions(embedded?.options ?? embedded?.questionOptions);
  if (fromQuestion && fromQuestion.length > 0) return fromQuestion;
  if (fromEmbedded && fromEmbedded.length > 0) return fromEmbedded;
  return [];
}

function chooseAnswer(
  legacyQuestion: LegacyQuestionSource | null | undefined,
  embedded: Record<string, unknown> | null | undefined
): unknown {
  const candidates = [
    legacyQuestion?.answer,
    legacyQuestion?.questionAnswer,
    embedded?.answer,
    embedded?.questionAnswer,
  ];
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) continue;
    if (typeof candidate === "string" && candidate.trim() === "") continue;
    return candidate;
  }
  return undefined;
}

function chooseType(
  legacyQuestion: LegacyQuestionSource | null | undefined,
  embedded: Record<string, unknown> | null | undefined
): unknown {
  const candidates = [
    legacyQuestion?.type,
    legacyQuestion?.questionType,
    embedded?.type,
    embedded?.questionType,
    embedded?.answerType,
    legacyQuestion?.answerType,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim() !== "") return candidate;
  }
  return undefined;
}

function isAbsentAnswer(answer: unknown): boolean {
  if (answer == null) return true;
  return typeof answer === "string" && (answer.trim() === "" || answer.trim().toUpperCase() === ABSENT_ANSWER);
}

function resolveCorrectIndex(options: OptionDraft[], answer: unknown): number | undefined {
  if (typeof answer === "number" && Number.isInteger(answer) && answer >= 0 && answer < options.length) {
    return answer;
  }
  if (typeof answer !== "string") return undefined;

  const raw = answer.trim();
  if (!raw || raw.toUpperCase() === ABSENT_ANSWER) return undefined;
  if (/^\d+$/.test(raw)) {
    const index = Number(raw);
    if (index >= 0 && index < options.length) return index;
  }

  const exact = options.findIndex((option) => option.text === raw);
  if (exact >= 0) return exact;
  const insensitive = options.findIndex((option) => option.text.toLowerCase() === raw.toLowerCase());
  return insensitive >= 0 ? insensitive : undefined;
}

function resolveCorrectIndexes(options: OptionDraft[], answer: unknown): number[] {
  if (Array.isArray(answer)) {
    const indexes = answer.flatMap((item) => {
      const index = resolveCorrectIndex(options, item);
      return index === undefined ? [] : [index];
    });
    if (indexes.length > 0) return [...new Set(indexes)];
  }

  const single = resolveCorrectIndex(options, answer);
  if (single !== undefined) return [single];
  return options.flatMap((option, index) => (option.isCorrect ? [index] : []));
}

function storedOptions(options: OptionDraft[], correct: number[]): Array<{ text: string; isCorrect: boolean }> {
  return options.map((option, index) => ({
    text: option.text,
    isCorrect: correct.includes(index),
  }));
}

export function buildExamQuestionPayload(input: {
  promptId: string;
  marks: unknown;
  negativeMarking?: unknown;
  negativeMarkingPercentage?: unknown;
  legacyQuestion?: LegacyQuestionSource | null;
  embedded?: Record<string, unknown> | null;
}): MappedExamQuestion {
  if (!input.promptId.trim()) {
    throw new Error("ExamQuestion promptId is required");
  }

  const options = chooseOptions(input.legacyQuestion, input.embedded);
  const rawType = chooseType(input.legacyQuestion, input.embedded);
  const questionType = mapLegacyQuestionType(rawType, options.length > 0);
  if (!questionType) {
    throw new Error(`Unsupported question type "${String(rawType)}"`);
  }

  const marks = migratedQuestionMarks(input.marks);
  const negativeMarks = negativeMarksForMigratedQuestion(
    marks,
    input.negativeMarking,
    input.negativeMarkingPercentage
  );
  const rawAnswer = chooseAnswer(input.legacyQuestion, input.embedded);
  const correct = resolveCorrectIndexes(options, rawAnswer);
  const mappedOptions = options.length > 0 ? storedOptions(options, correct) : undefined;

  if (questionType === "TEXT") {
    const answer = isAbsentAnswer(rawAnswer) ? "" : typeof rawAnswer === "string" ? rawAnswer : String(rawAnswer);
    return {
      promptId: input.promptId,
      questionType,
      marks,
      negativeMarks,
      ...(mappedOptions ? { options: mappedOptions } : {}),
      answer,
    };
  }

  return {
    promptId: input.promptId,
    questionType,
    marks,
    negativeMarks,
    ...(mappedOptions ? { options: mappedOptions } : {}),
    answer: correct.length > 0 ? correct : isAbsentAnswer(rawAnswer) ? "" : rawAnswer,
  };
}

function isObjectIdLike(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as { _bsontype?: unknown; toHexString?: unknown };
  return record._bsontype === "ObjectId" || typeof record.toHexString === "function";
}

function isLegacyEmbeddedQuestion(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value) || isObjectIdLike(value)) return false;
  return documentId((value as { questionId?: unknown }).questionId).length > 0;
}

function isExamQuestionReference(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  return isObjectIdLike(value);
}

export function classifyExamQuestions(questions: unknown): "empty" | "migrated" | "legacy" | "unrecognized" {
  if (!Array.isArray(questions) || questions.length === 0) return "empty";

  let legacy = 0;
  let migrated = 0;
  for (const entry of questions) {
    if (isLegacyEmbeddedQuestion(entry)) {
      legacy += 1;
    } else if (isExamQuestionReference(entry)) {
      migrated += 1;
    } else {
      return "unrecognized";
    }
  }

  if (legacy > 0 && migrated > 0) return "unrecognized";
  if (legacy > 0) return "legacy";
  return "migrated";
}

export function planExamConversion(
  exam: {
    _id?: unknown;
    questions?: unknown;
    negativeMarking?: unknown;
    negativeMarkingPercentage?: unknown;
  },
  promptsByQuestionId: ReadonlyMap<string, PromptLink>
): ExamConversionPlan {
  const kind = classifyExamQuestions(exam.questions);
  if (kind === "empty") return { status: "skip-empty" };
  if (kind === "migrated") return { status: "skip-migrated" };
  if (kind === "unrecognized") {
    return {
      status: "failed",
      error: "Exam questions are a mix of legacy entries and ExamQuestion ids, or are not a recognized shape; left unchanged",
    };
  }

  const examId = documentId(exam._id);
  if (!examId) return { status: "failed", error: "Exam is missing an id" };

  const entries = exam.questions as Array<Record<string, unknown>>;
  const questions: ExamQuestionWrite[] = [];

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const legacyQuestionId = documentId(entry?.questionId);
    if (!legacyQuestionId) {
      return { status: "failed", error: `Question ${index + 1} is missing questionId` };
    }

    const source = promptsByQuestionId.get(legacyQuestionId);
    if (!source?.promptId) {
      return { status: "failed", error: `No prompt found for question ${legacyQuestionId}` };
    }

    let data: MappedExamQuestion;
    try {
      const marks =
        entry.marks !== undefined && entry.marks !== null ? entry.marks : source.question.marks;
      data = buildExamQuestionPayload({
        promptId: source.promptId,
        marks,
        negativeMarking: exam.negativeMarking,
        negativeMarkingPercentage: exam.negativeMarkingPercentage,
        legacyQuestion: source.question,
        embedded: entry,
      });
    } catch (error) {
      return {
        status: "failed",
        error: `Question ${legacyQuestionId}: ${(error as Error).message}`,
      };
    }

    const parsed = examQuestionZodSchema.safeParse(data);
    if (!parsed.success) {
      return {
        status: "failed",
        error: `Question ${legacyQuestionId} does not match the ExamQuestion schema: ${parsed.error.message}`,
      };
    }

    questions.push({
      id: migratedExamQuestionId(examId, legacyQuestionId, index),
      data: parsed.data as MappedExamQuestion,
    });
  }

  return {
    status: "convert",
    questions,
    examUpdate: { questions: questions.map((question) => question.id) },
  };
}

export function migrationExitCode(failures: readonly MigrationFailure[]): number {
  return failures.length === 0 ? 0 : 1;
}

export function formatMigrationReport(failures: readonly MigrationFailure[], dryRun: boolean): string[] {
  if (failures.length === 0) {
    return [
      dryRun ? "Migration dry run completed. No documents were written." : "Migration completed.",
      "Exams that already reference ExamQuestion ids were left unchanged.",
    ];
  }

  const mode = dryRun ? "Migration dry run failed" : "Migration failed";
  return [
    `${mode} with ${failures.length} error(s). Failed exams were not rewritten.`,
    ...failures.map((failure) => `[${failure.step}] ${failure.id}: ${failure.error}`),
  ];
}
