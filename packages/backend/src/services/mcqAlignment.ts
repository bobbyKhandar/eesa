export type OptionInput = string | { text?: string; isCorrect?: boolean };

export interface NormalizedMcqResponse {
  text: string;
  index: number | null;
}

export function optionText(option: OptionInput): string {
  return typeof option === "string" ? option : String(option?.text ?? "");
}

/**
 * Canonical MCQ representation is the option text.
 * A numeric string is an option index; any other value is matched against option text.
 * Both forms resolve to the same { text, index } pair.
 */
export function normalizeMcqResponse(
  userResponse: string | null | undefined,
  options: OptionInput[] | null | undefined
): NormalizedMcqResponse {
  const texts = (options ?? []).map(optionText);
  const raw = String(userResponse ?? "").trim();
  if (!raw) return { text: "", index: null };

  if (/^\d+$/.test(raw)) {
    const index = Number(raw);
    if (index >= 0 && index < texts.length) {
      return { text: texts[index], index };
    }
  }

  const exact = texts.findIndex((text) => text === raw);
  if (exact >= 0) return { text: texts[exact], index: exact };

  const insensitive = texts.findIndex((text) => text.toLowerCase() === raw.toLowerCase());
  if (insensitive >= 0) return { text: texts[insensitive], index: insensitive };

  return { text: raw, index: null };
}

function textsFromAnswer(answer: unknown, options: OptionInput[]): string[] {
  const texts = options.map(optionText);
  if (Array.isArray(answer)) {
    return answer.flatMap((item) => textsFromAnswer(item, options));
  }
  if (typeof answer === "number" && Number.isInteger(answer) && texts[answer]) {
    return [texts[answer]];
  }
  if (typeof answer === "string" && answer.trim()) {
    const normalized = normalizeMcqResponse(answer, options);
    return [normalized.index !== null ? normalized.text : answer.trim()];
  }
  return [];
}

/**
 * Correct options come from isCorrect flags when any are set.
 * Otherwise the answer field is used (index, index list, or option text).
 */
export function correctOptionTexts(question: {
  options?: OptionInput[] | null;
  answer?: unknown;
  correctAnswer?: unknown;
}): string[] {
  const options = question.options ?? [];
  const flagged = options
    .map((option, index) =>
      typeof option === "object" && option?.isCorrect ? optionText(option) || optionText(options[index]) : null
    )
    .filter((text): text is string => !!text);

  if (flagged.length > 0) return [...new Set(flagged)];

  const fromAnswer = [
    ...textsFromAnswer(question.answer, options),
    ...textsFromAnswer(question.correctAnswer, options),
  ];
  return [...new Set(fromAnswer.filter(Boolean))];
}

export function isObjectiveQuestion(questionType: string | null | undefined): boolean {
  const type = String(questionType ?? "").toLowerCase().replace(/[\s-]/g, "_");
  return type === "mcq" || type === "true_false" || type === "truefalse";
}

export function serverQuestionMarks(question: { marks?: number; maxMarks?: number } | null | undefined): number {
  const marks = question?.marks ?? question?.maxMarks;
  if (typeof marks !== "number" || !Number.isFinite(marks) || marks < 0) return 0;
  return marks;
}

export function questionIdOf(question: { _id?: { toString(): string } | string }): string {
  if (question._id == null) return "";
  return typeof question._id === "string" ? question._id : question._id.toString();
}

/**
 * Persist MCQ options so the correctOption index and isCorrect flag name the same choice.
 * The stored answer is that index, which grading resolves back to option text.
 */
export function buildStoredQuestionOptions(question: {
  options?: string[] | null;
  correctOption?: number;
  answer?: unknown;
}): { options?: Array<{ text: string; isCorrect: boolean }>; answer: unknown } {
  const hasOptions = Array.isArray(question.options);
  const correctIndex = typeof question.correctOption === "number" ? question.correctOption : undefined;
  const options = hasOptions
    ? question.options!.map((opt, index) => ({
        text: opt,
        isCorrect: correctIndex !== undefined && index === correctIndex,
      }))
    : undefined;
  const answer = correctIndex !== undefined ? [correctIndex] : (question.answer ?? "");
  return { options, answer };
}

export function presentSubmissionQuestion(
  question: {
    _id?: { toString(): string } | string;
    questionType?: string;
    marks?: number;
    options?: OptionInput[] | null;
    answer?: unknown;
    correctAnswer?: unknown;
    promptData?: { questionText?: string };
    questionText?: string;
  },
  response?: {
    questionId?: string;
    userResponse?: string;
    maxMarks?: number;
    allottedMarks?: number;
    feedback?: string;
    suggestions?: string[];
  } | null
) {
  const options = (question.options ?? []).map(optionText);
  const objective = isObjectiveQuestion(question.questionType);
  const stored = response?.userResponse ?? "";
  const normalized = objective ? normalizeMcqResponse(stored, question.options ?? []).text : stored;
  const type = String(question.questionType ?? "text").toLowerCase();
  const correct = correctOptionTexts(question);

  return {
    id: questionIdOf(question),
    questionId: questionIdOf(question),
    text: question.promptData?.questionText || question.questionText || "",
    type: type === "true_false" ? "mcq" : type,
    options,
    correctAnswer: correct[0] || "",
    feedback: response?.feedback || "",
    maxScore: serverQuestionMarks(question),
    userResponse: response
      ? {
          ...response,
          userResponse: normalized || stored,
        }
      : undefined,
  };
}
