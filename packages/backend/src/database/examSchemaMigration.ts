import { createHash } from "node:crypto";
import { examQuestionZodSchema } from "./schemas/examQuestionSchemaZod.js";
import { submissionResponseZodSchema } from "./schemas/examSubmissionZod.js";

/**
 * Maps a legacy exam's embedded `{ questionId, marks }` entries onto the
 * ExamQuestion schema. Already-migrated exams (an array of ExamQuestion ids)
 * are skipped so a re-run does not rewrite assignees, createdBy, or deletedAt.
 * Failed exams produce no update. ExamQuestion ids are derived from the exam
 * id and the legacy question id, so a retry upserts the same documents.
 *
 * Submission answers are translated into responses before a submission is
 * written. A payload that cannot be mapped produces no update. The legacy
 * answers field is not removed, so a later run can restore responses that an
 * older run replaced with an empty array.
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
  legacyQuestionId?: string;
  data: MappedExamQuestion;
}

export interface LegacyQuestionLink {
  examQuestionId: string;
  marks?: number;
}

export interface MappedSubmissionResponse {
  questionId: string;
  userResponse: string;
  maxMarks: number;
  allottedMarks: number;
  feedback?: string;
  suggestions?: string[];
}

export interface SubmissionFieldUpdate {
  userId?: string;
  responses?: MappedSubmissionResponse[];
}

export interface SubmissionRollback {
  userId: unknown;
  responses: unknown;
  answers: unknown;
  hadUserId: boolean;
  hadResponses: boolean;
  wroteUserId: boolean;
  wroteResponses: boolean;
}

export interface SubmissionRollbackUpdate {
  set: Record<string, unknown>;
  unset: Record<string, "">;
}

export interface SubmissionConversionPlan {
  status: "skip" | "failed" | "convert";
  error?: string;
  update?: SubmissionFieldUpdate;
  rollback?: SubmissionRollback;
}

export interface SubmissionConversionInput {
  _id?: unknown;
  examId?: unknown;
  userId?: unknown;
  studentEmail?: unknown;
  responses?: unknown;
  answers?: unknown;
  questionEvaluations?: unknown;
  evaluations?: unknown;
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
      legacyQuestionId,
      data: parsed.data as MappedExamQuestion,
    });
  }

  return {
    status: "convert",
    questions,
    examUpdate: { questions: questions.map((question) => question.id) },
  };
}

const ANSWER_KEYS = new Set([
  "questionId",
  "examQuestionId",
  "questionText",
  "userResponse",
  "response",
  "answer",
  "text",
  "marks",
  "maxMarks",
  "allottedMarks",
  "allocatedMarks",
  "feedback",
  "suggestions",
  "isCorrect",
  "_id",
  "__v",
]);

interface DraftResponse {
  questionId: string;
  userResponse: string;
  maxMarks?: number;
  allottedMarks?: number;
  feedback?: string;
  suggestions?: string[];
}

function existingUserId(value: unknown): string {
  if (typeof value === "string") return value.trim();
  return documentId(value);
}

function readMark(value: unknown): number | "invalid" {
  if (typeof value === "number") return Number.isFinite(value) ? value : "invalid";
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return "invalid";
}

function pickMark(record: Record<string, unknown>, keys: string[]): number | undefined | "invalid" {
  const present = keys.filter((key) => record[key] !== undefined && record[key] !== null);
  if (present.length === 0) return undefined;
  const values = present.map((key) => readMark(record[key]));
  if (values.some((value) => value === "invalid")) return "invalid";
  const numbers = values as number[];
  if (numbers.some((value) => value !== numbers[0])) return "invalid";
  return numbers[0];
}

function scalarResponse(value: unknown): string | "invalid" | "absent" {
  if (value === undefined) return "absent";
  if (value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "invalid";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) {
    const primitive = value.every(
      (item) => typeof item === "string" || typeof item === "number" || typeof item === "boolean"
    );
    return primitive ? JSON.stringify(value) : "invalid";
  }
  return "invalid";
}

function readSuggestions(value: unknown): string[] | undefined | "invalid" {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return "invalid";
  return value;
}

function readObjectAnswer(
  value: Record<string, unknown>,
  fallbackQuestionId?: string
): DraftResponse | "invalid" {
  for (const key of Object.keys(value)) {
    if (!ANSWER_KEYS.has(key) && value[key] !== undefined) return "invalid";
  }

  const ownId = documentId(value.questionId) || documentId(value.examQuestionId);
  const questionId = ownId || fallbackQuestionId?.trim() || "";
  if (!questionId) return "invalid";
  if (fallbackQuestionId && ownId && ownId !== fallbackQuestionId.trim()) return "invalid";

  const textFields = ["userResponse", "response", "answer", "text"].filter((key) => key in value);
  const texts: string[] = [];
  for (const key of textFields) {
    const text = scalarResponse(value[key]);
    if (text === "invalid") return "invalid";
    if (text !== "absent") texts.push(text);
  }
  if (texts.length === 0 || texts.some((text) => text !== texts[0])) return "invalid";

  const maxMarks = pickMark(value, ["maxMarks", "marks"]);
  if (maxMarks === "invalid") return "invalid";
  const allottedMarks = pickMark(value, ["allottedMarks", "allocatedMarks"]);
  if (allottedMarks === "invalid") return "invalid";

  let feedback: string | undefined;
  if ("feedback" in value && value.feedback !== undefined) {
    if (typeof value.feedback !== "string") return "invalid";
    feedback = value.feedback;
  }
  const suggestions = readSuggestions(value.suggestions);
  if (suggestions === "invalid") return "invalid";

  return {
    questionId,
    userResponse: texts[0],
    ...(maxMarks !== undefined ? { maxMarks } : {}),
    ...(allottedMarks !== undefined ? { allottedMarks } : {}),
    ...(feedback !== undefined ? { feedback } : {}),
    ...(suggestions !== undefined ? { suggestions } : {}),
  };
}

function readAnswerMap(value: Record<string, unknown>): DraftResponse[] | "invalid" {
  const drafts: DraftResponse[] = [];
  for (const [key, raw] of Object.entries(value)) {
    const questionId = key.trim();
    if (!questionId) return "invalid";
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const parsed = readObjectAnswer(raw as Record<string, unknown>, questionId);
      if (parsed === "invalid") return "invalid";
      drafts.push(parsed);
      continue;
    }
    const text = scalarResponse(raw);
    if (text === "invalid" || text === "absent") return "invalid";
    drafts.push({ questionId, userResponse: text });
  }
  return drafts;
}

function readAnswerList(value: unknown[]): DraftResponse[] | "invalid" {
  const drafts: DraftResponse[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return "invalid";
    const parsed = readObjectAnswer(item as Record<string, unknown>);
    if (parsed === "invalid") return "invalid";
    drafts.push(parsed);
  }
  return drafts;
}

function readPayload(value: unknown): DraftResponse[] | "empty" | "invalid" {
  if (value === undefined || value === null) return "empty";
  if (value instanceof Map) return readPayload(Object.fromEntries(value.entries()));
  if (Array.isArray(value)) {
    if (value.length === 0) return "empty";
    return readAnswerList(value);
  }
  if (typeof value === "object") {
    const drafts = readAnswerMap(value as Record<string, unknown>);
    if (drafts === "invalid") return "invalid";
    return drafts.length === 0 ? "empty" : drafts;
  }
  return "invalid";
}

function isCompleteNewResponse(value: unknown): value is MappedSubmissionResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.questionId !== "string" || record.questionId.trim() === "") return false;
  if (typeof record.userResponse !== "string") return false;
  if (typeof record.maxMarks !== "number" || !Number.isFinite(record.maxMarks)) return false;
  if (typeof record.allottedMarks !== "number" || !Number.isFinite(record.allottedMarks)) return false;
  if (record.feedback !== undefined && typeof record.feedback !== "string") return false;
  if (record.suggestions !== undefined) {
    if (!Array.isArray(record.suggestions) || record.suggestions.some((item) => typeof item !== "string")) {
      return false;
    }
  }
  return true;
}

function legacyAnswerDrafts(submission: SubmissionConversionInput): DraftResponse[] | "none" | "invalid" {
  const fields = [submission.answers, submission.questionEvaluations, submission.evaluations];
  const lists: DraftResponse[][] = [];
  for (const field of fields) {
    if (field === undefined || field === null) continue;
    const read = readPayload(field);
    if (read === "invalid") return "invalid";
    if (read === "empty") continue;
    lists.push(read);
  }
  if (lists.length === 0) return "none";
  const merged = lists[0].map((draft) => ({ ...draft }));
  for (const extraList of lists.slice(1)) {
    if (extraList.length !== merged.length) return "invalid";
    for (let index = 0; index < merged.length; index += 1) {
      const target = merged[index];
      const extra = extraList[index];
      if (target.questionId !== extra.questionId || target.userResponse !== extra.userResponse) return "invalid";
      if (extra.maxMarks !== undefined) {
        if (target.maxMarks !== undefined && target.maxMarks !== extra.maxMarks) return "invalid";
        target.maxMarks = extra.maxMarks;
      }
      if (extra.allottedMarks !== undefined) {
        if (target.allottedMarks !== undefined && target.allottedMarks !== extra.allottedMarks) return "invalid";
        target.allottedMarks = extra.allottedMarks;
      }
      if (extra.feedback !== undefined) {
        if (target.feedback !== undefined && target.feedback !== extra.feedback) return "invalid";
        target.feedback = extra.feedback;
      }
      if (extra.suggestions !== undefined) {
        if (
          target.suggestions !== undefined &&
          JSON.stringify(target.suggestions) !== JSON.stringify(extra.suggestions)
        ) {
          return "invalid";
        }
        target.suggestions = extra.suggestions;
      }
    }
  }
  return merged;
}

function applyQuestionLinks(
  drafts: DraftResponse[],
  links: ReadonlyMap<string, LegacyQuestionLink> | undefined
): MappedSubmissionResponse[] | "invalid" {
  const mapped: MappedSubmissionResponse[] = [];
  const seen = new Set<string>();
  for (const draft of drafts) {
    const link = links?.get(draft.questionId);
    const response = {
      questionId: link?.examQuestionId ?? draft.questionId,
      userResponse: draft.userResponse,
      maxMarks: draft.maxMarks ?? link?.marks ?? 0,
      allottedMarks: draft.allottedMarks ?? 0,
      ...(draft.feedback !== undefined ? { feedback: draft.feedback } : {}),
      ...(draft.suggestions !== undefined ? { suggestions: draft.suggestions } : {}),
    };
    if (seen.has(response.questionId)) return "invalid";
    seen.add(response.questionId);
    const parsed = submissionResponseZodSchema.safeParse(response);
    if (!parsed.success) return "invalid";
    mapped.push(parsed.data as MappedSubmissionResponse);
  }
  return mapped;
}

function failedSubmission(error: string): SubmissionConversionPlan {
  return { status: "failed", error };
}

export function matchStoredExamQuestions(
  examId: string,
  legacyQuestionIds: readonly string[],
  examQuestionIds: readonly string[],
  marksByExamQuestionId?: ReadonlyMap<string, number>
): Map<string, LegacyQuestionLink> {
  const present = new Set(examQuestionIds);
  const links = new Map<string, LegacyQuestionLink>();
  for (const legacyId of new Set(legacyQuestionIds)) {
    const matches: string[] = [];
    for (let index = 0; index < examQuestionIds.length; index += 1) {
      const id = migratedExamQuestionId(examId, legacyId, index);
      if (present.has(id)) matches.push(id);
    }
    if (matches.length !== 1) continue;
    const marks = marksByExamQuestionId?.get(matches[0]);
    links.set(legacyId, {
      examQuestionId: matches[0],
      ...(typeof marks === "number" ? { marks } : {}),
    });
  }
  return links;
}

export function legacyQuestionLinks(
  questions: readonly ExamQuestionWrite[]
): Map<string, LegacyQuestionLink> | undefined {
  const links = new Map<string, LegacyQuestionLink>();
  for (const question of questions) {
    const legacyId = question.legacyQuestionId?.trim();
    if (!legacyId) continue;
    const existing = links.get(legacyId);
    const next = { examQuestionId: question.id, marks: question.data.marks };
    if (existing && (existing.examQuestionId !== next.examQuestionId || existing.marks !== next.marks)) {
      return undefined;
    }
    links.set(legacyId, next);
  }
  return links;
}

/**
 * Plans one submission write. Already-stored responses are kept. An empty
 * responses array is rebuilt from a surviving answers or evaluation payload.
 * The returned rollback restores userId and responses for that document only.
 * answers is never part of the write or the rollback update.
 */
export function planSubmissionConversion(
  submission: SubmissionConversionInput,
  options?: {
    resolvedUserId?: string | null;
    questionLinks?: ReadonlyMap<string, LegacyQuestionLink>;
    examQuestionIds?: readonly string[];
    marksByExamQuestionId?: ReadonlyMap<string, number>;
  }
): SubmissionConversionPlan {
  const preserved = Array.isArray(submission.responses) && submission.responses.every(isCompleteNewResponse);
  const responsesEmpty = !Array.isArray(submission.responses) || submission.responses.length === 0;
  let translated: MappedSubmissionResponse[] | undefined;

  if (!(preserved && !responsesEmpty)) {
    let drafts: DraftResponse[] | "none" | "invalid" = "none";
    if (Array.isArray(submission.responses) && submission.responses.length > 0) {
      drafts = readAnswerList(submission.responses);
    } else if (submission.responses !== undefined && submission.responses !== null && !Array.isArray(submission.responses)) {
      const read = readPayload(submission.responses);
      drafts = read === "empty" ? "none" : read;
    } else {
      drafts = legacyAnswerDrafts(submission);
    }

    if (drafts === "invalid") {
      return failedSubmission(
        "Submission answers could not be translated without dropping answer data; submission left unchanged"
      );
    }
    if (drafts !== "none") {
      const examId = documentId(submission.examId);
      const links =
        options?.questionLinks ??
        (examId && options?.examQuestionIds && options.examQuestionIds.length > 0
          ? matchStoredExamQuestions(
              examId,
              drafts.map((draft) => draft.questionId),
              options.examQuestionIds,
              options.marksByExamQuestionId
            )
          : undefined);
      const mapped = applyQuestionLinks(drafts, links);
      if (mapped === "invalid") {
        return failedSubmission(
          "Submission answers could not be translated without dropping answer data; submission left unchanged"
        );
      }
      translated = mapped;
    }
  }

  const userId = existingUserId(submission.userId);
  let resolvedUserId = userId;
  if (!resolvedUserId) {
    const provided = typeof options?.resolvedUserId === "string" ? options.resolvedUserId.trim() : "";
    if (!provided) {
      const email = typeof submission.studentEmail === "string" ? submission.studentEmail.trim() : "";
      return failedSubmission(
        email
          ? `No user found for email ${email}; submission left unchanged`
          : "Submission has no userId or studentEmail; submission left unchanged"
      );
    }
    resolvedUserId = provided;
  }

  const update: SubmissionFieldUpdate = {};
  if (!userId) update.userId = resolvedUserId;
  if (translated && translated.length > 0) update.responses = translated;
  if (!update.userId && !update.responses) return { status: "skip" };

  const hadResponses = submission.responses !== undefined && submission.responses !== null;
  return {
    status: "convert",
    update,
    rollback: {
      userId: submission.userId,
      responses: submission.responses,
      answers: submission.answers,
      hadUserId: userId.length > 0,
      hadResponses,
      wroteUserId: update.userId !== undefined,
      wroteResponses: update.responses !== undefined,
    },
  };
}

export function submissionRollbackUpdate(rollback: SubmissionRollback): SubmissionRollbackUpdate {
  const set: Record<string, unknown> = {};
  const unset: Record<string, ""> = {};
  if (rollback.wroteUserId) {
    if (rollback.hadUserId) set.userId = rollback.userId;
    else unset.userId = "";
  }
  if (rollback.wroteResponses) {
    if (rollback.hadResponses) set.responses = rollback.responses;
    else unset.responses = "";
  }
  return { set, unset };
}

export function submissionWriteLanded(
  stored: { userId?: unknown; responses?: unknown },
  update: SubmissionFieldUpdate
): boolean {
  if (update.userId && documentId(stored.userId) !== update.userId && stored.userId !== update.userId) {
    return false;
  }
  if (!update.responses) return true;
  if (!Array.isArray(stored.responses) || stored.responses.length !== update.responses.length) return false;
  return update.responses.every((response, index) => {
    const item = stored.responses?.[index] as Record<string, unknown> | undefined;
    if (!item || typeof item !== "object") return false;
    const feedback = item.feedback === undefined ? undefined : item.feedback;
    const suggestions = item.suggestions === undefined ? undefined : item.suggestions;
    return (
      (typeof item.questionId === "string" ? item.questionId : documentId(item.questionId)) === response.questionId &&
      item.userResponse === response.userResponse &&
      item.maxMarks === response.maxMarks &&
      item.allottedMarks === response.allottedMarks &&
      feedback === response.feedback &&
      JSON.stringify(suggestions ?? undefined) === JSON.stringify(response.suggestions ?? undefined)
    );
  });
}

export function migrationExitCode(failures: readonly MigrationFailure[]): number {
  return failures.length === 0 ? 0 : 1;
}

export function formatMigrationReport(failures: readonly MigrationFailure[], dryRun: boolean): string[] {
  if (failures.length === 0) {
    return [
      dryRun ? "Migration dry run completed. No documents were written." : "Migration completed.",
      "Exams that already reference ExamQuestion ids were left unchanged.",
      "Submission answers are kept. A re-run restores responses from a surviving answers field when responses are empty.",
    ];
  }

  const mode = dryRun ? "Migration dry run failed" : "Migration failed";
  return [
    `${mode} with ${failures.length} error(s). Failed exams and submissions were not rewritten.`,
    ...failures.map((failure) => `[${failure.step}] ${failure.id}: ${failure.error}`),
  ];
}
