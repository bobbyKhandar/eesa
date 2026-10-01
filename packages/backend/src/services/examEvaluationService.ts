import {
  correctOptionTexts,
  isObjectiveQuestion,
  normalizeMcqResponse,
  questionIdOf,
  serverQuestionMarks,
  type OptionInput,
} from "./mcqAlignment.js";

export interface ClientExamResponse {
  questionId: string;
  userResponse?: string;
  maxMarks?: number;
}

export interface ExamQuestionForEvaluation {
  _id?: { toString(): string } | string;
  questionType?: string;
  marks?: number;
  negativeMarks?: number;
  options?: OptionInput[] | null;
  answer?: unknown;
  promptData?: { questionText?: string };
  questionText?: string;
}

export interface EvaluatedResponse {
  questionId: string;
  userResponse: string;
  maxMarks: number;
  allottedMarks: number;
  feedback?: string;
  suggestions?: string[];
}

export interface TextGradeInput {
  questionText: string;
  userResponse: string;
  maxMarks: number;
  rubric?: string;
}

export interface TextGradeResult {
  allottedMarks: number;
  feedback: string;
  suggestions: string[];
}

export interface EvaluationSuccess {
  responses: EvaluatedResponse[];
  maxMarks: number;
  marksAchieved: number;
}

export interface EvaluationFailure {
  error: string;
}

interface PreparedResponse extends EvaluatedResponse {
  questionText: string;
  questionType: string;
  options?: OptionInput[] | null;
  answer?: unknown;
  negativeMarks: number;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function gradeObjective(response: PreparedResponse): EvaluatedResponse {
  const options = response.options ?? [];
  const normalized = normalizeMcqResponse(response.userResponse, options);
  const correct = correctOptionTexts({ options, answer: response.answer });
  const selected = normalized.text;
  const isCorrect = selected !== "" && correct.includes(selected);
  let allottedMarks = 0;
  if (isCorrect) {
    allottedMarks = response.maxMarks;
  } else if (selected && (response.negativeMarks ?? 0) > 0) {
    allottedMarks = -Math.abs(response.negativeMarks ?? 0);
  }

  return {
    questionId: response.questionId,
    userResponse: selected,
    maxMarks: response.maxMarks,
    allottedMarks,
    feedback: selected ? (isCorrect ? "Correct" : "Incorrect") : "No answer provided",
    suggestions: [],
  };
}

async function defaultGradeText(input: TextGradeInput): Promise<TextGradeResult> {
  const apiKey = process.env.gemini_api_key || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("gemini_api_key is not configured");
  }
  const { GoogleGenerativeAI } = await import("@google/generative-ai");
  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: "gemini-2.5-flash" });
  const prompt = `You grade one exam answer. Award an integer allottedMarks from 0 to ${input.maxMarks} based on accuracy and completeness.
Question (${input.maxMarks} marks): ${input.questionText}
${input.rubric ? `Rubric or sample answer (do not quote it back): ${input.rubric}` : ""}
Student answer: ${input.userResponse || "[blank]"}
Respond with JSON only: {"allottedMarks": number, "feedback": string, "suggestions": string[]}`;

  const result = await model.generateContent(prompt);
  const text = result.response.text().replace(/^```json\s*|\s*```$/g, "").trim();
  const parsed = JSON.parse(text) as { allottedMarks?: unknown; feedback?: unknown; suggestions?: unknown };
  return {
    allottedMarks: Number(parsed.allottedMarks) || 0,
    feedback: String(parsed.feedback ?? ""),
    suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.map((item) => String(item)) : [],
  };
}

export function prepareExamResponses(
  questions: ExamQuestionForEvaluation[],
  clientResponses: ClientExamResponse[]
): { responses: PreparedResponse[] } | EvaluationFailure {
  const known = new Map(questions.map((question) => [questionIdOf(question), question]));
  for (const response of clientResponses) {
    if (!known.has(String(response.questionId))) {
      return { error: `Unknown question: ${response.questionId}` };
    }
  }

  const submitted = new Map(clientResponses.map((response) => [String(response.questionId), response]));
  const responses = questions.map((question) => {
    const id = questionIdOf(question);
    const submittedResponse = submitted.get(id);
    const questionType = question.questionType || "TEXT";
    const raw = submittedResponse?.userResponse || "";
    const userResponse = isObjectiveQuestion(questionType)
      ? normalizeMcqResponse(raw, question.options ?? []).text
      : raw;
    return {
      questionId: id,
      questionText: question.promptData?.questionText || question.questionText || "",
      questionType,
      userResponse,
      maxMarks: serverQuestionMarks(question),
      allottedMarks: 0,
      options: question.options,
      answer: question.answer,
      negativeMarks: typeof question.negativeMarks === "number" ? question.negativeMarks : 0,
    };
  });

  return { responses };
}

/**
 * Grade prepared responses. Objective questions with a known key are graded
 * from the canonical option text. Other questions go through the text grader.
 * maxMarks on each response is trusted only because prepareExamResponses
 * overwrites any client-supplied value.
 */
export async function evaluateExamResponses(
  responses: PreparedResponse[],
  deps?: { gradeText?: (input: TextGradeInput) => Promise<TextGradeResult> }
): Promise<EvaluatedResponse[]> {
  const gradeText = deps?.gradeText ?? defaultGradeText;
  const evaluated: EvaluatedResponse[] = [];

  for (const response of responses) {
    const correct = correctOptionTexts({ options: response.options, answer: response.answer });
    if (isObjectiveQuestion(response.questionType) && (response.options?.length ?? 0) > 0 && correct.length > 0) {
      evaluated.push(gradeObjective(response));
      continue;
    }

    const graded = await gradeText({
      questionText: response.questionText,
      userResponse: response.userResponse,
      maxMarks: response.maxMarks,
      rubric: typeof response.answer === "string" ? response.answer : undefined,
    });
    evaluated.push({
      questionId: response.questionId,
      userResponse: response.userResponse,
      maxMarks: response.maxMarks,
      allottedMarks: clamp(graded.allottedMarks, 0, response.maxMarks),
      feedback: graded.feedback,
      suggestions: graded.suggestions ?? [],
    });
  }

  return evaluated;
}

/**
 * Entry point used by the submission API.
 * Client maxMarks is ignored. Totals come from the exam's question marks.
 */
export async function evaluateExamSubmission(
  questions: ExamQuestionForEvaluation[],
  clientResponses: ClientExamResponse[],
  deps?: { gradeText?: (input: TextGradeInput) => Promise<TextGradeResult> }
): Promise<EvaluationSuccess | EvaluationFailure> {
  const prepared = prepareExamResponses(questions, clientResponses);
  if ("error" in prepared) return prepared;

  const responses = await evaluateExamResponses(prepared.responses, deps);
  const maxMarks = questions.reduce((sum, question) => sum + serverQuestionMarks(question), 0);
  const marksAchieved = responses.reduce((sum, response) => sum + response.allottedMarks, 0);
  return { responses, maxMarks, marksAchieved };
}
