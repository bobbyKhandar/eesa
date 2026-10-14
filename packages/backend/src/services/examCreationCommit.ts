import {
  ExamCreationAborted,
  isExamCreationAborted,
  isTransactionsUnsupportedError,
} from "../database/examWriteRollback.js";

export interface ExamCreationPromptInput {
  questionText: string;
  subject: string;
  topic?: string;
  generateVia: "llm" | "ocr" | "user";
  source?: string;
  ocrConfidence?: number;
  createdBy: string;
  bloomsLevel?: "remember" | "understand" | "apply" | "analyze" | "evaluate" | "create";
}

export interface ExamCreationQuestionInput {
  marks: number;
  negativeMarks?: number;
  questionType: "MCQ" | "TEXT" | "TRUE_FALSE";
  answer: string | number[];
  options?: Array<{ text: string; isCorrect: boolean }>;
}

export interface ExamCreationExamInput {
  examTitle: string;
  examDescription: string;
  subject: string;
  examDegree: string;
  examType: string;
  passingPercentage: number;
  duration?: number;
  scheduledAt?: Date;
  createdBy: string;
  instructions?: string;
  negativeMarking?: boolean;
  negativeMarkingPercentage?: number;
  assignedUsers: string[];
}

export interface ExamCreationInput {
  prompts: ExamCreationPromptInput[];
  questions: ExamCreationQuestionInput[];
  exam: ExamCreationExamInput;
}

export interface ExamCreationExamWrite extends ExamCreationExamInput {
  questions: Array<ExamCreationQuestionInput & { promptId: string }>;
}

export interface PromptWriteResult {
  success: boolean;
  promptIds?: string[];
  error?: string;
}

export interface ExamWriteResult {
  success: boolean;
  examId?: string;
  error?: string;
  examQuestionIds?: string[];
}

export interface ExamCreationPorts<TSession> {
  runTransaction<T>(
    work: (session: TSession) => Promise<T>,
  ): Promise<{ supported: true; value: T } | { supported: false }>;
  createPrompts(prompts: ExamCreationPromptInput[], session: TSession | null): Promise<PromptWriteResult>;
  createExam(exam: ExamCreationExamWrite, session: TSession | null): Promise<ExamWriteResult>;
  deletePrompts(ids: string[]): Promise<void>;
  deleteExamQuestions(ids: string[]): Promise<void>;
}

export interface ExamCreationResult {
  success: boolean;
  examId?: string;
  error?: string;
}

/**
 * Insert prompts, exam questions, and the exam as one transaction when the
 * deployment supports it. Otherwise track the ids that were stored and delete
 * them if a later step fails. Allocation of users stays outside this write:
 * a failed allocation must not remove an exam that was created.
 */
export async function commitExamCreation<TSession>(
  input: ExamCreationInput,
  ports: ExamCreationPorts<TSession>,
): Promise<ExamCreationResult> {
  let transactional: { supported: true; value: string } | { supported: false };
  try {
    transactional = await ports.runTransaction((session) => writeExamRecords(input, ports, session));
  } catch (error) {
    if (isExamCreationAborted(error)) {
      return { success: false, error: error.message };
    }
    if (!isTransactionsUnsupportedError(error)) throw error;
    transactional = { supported: false };
  }

  if (transactional.supported) {
    return { success: true, examId: transactional.value };
  }

  try {
    const examId = await writeExamRecords(input, ports, null);
    return { success: true, examId };
  } catch (error) {
    if (isExamCreationAborted(error)) {
      await discardTracked(ports, error);
      return { success: false, error: error.message };
    }
    throw error;
  }
}

async function writeExamRecords<TSession>(
  input: ExamCreationInput,
  ports: ExamCreationPorts<TSession>,
  session: TSession | null,
): Promise<string> {
  let promptIds: string[] = [];
  try {
    const prompts = await ports.createPrompts(input.prompts, session);
    promptIds = prompts.promptIds ?? [];
    if (!prompts.success || promptIds.length !== input.questions.length) {
      throw new ExamCreationAborted(prompts.error || "Failed to create question prompts", { promptIds });
    }

    const exam = await ports.createExam(
      {
        ...input.exam,
        questions: input.questions.map((question, index) => ({
          ...question,
          promptId: promptIds[index] as string,
        })),
      },
      session,
    );
    if (!exam.success || !exam.examId) {
      throw new ExamCreationAborted(exam.error || "Failed to create exam", {
        promptIds,
        examQuestionIds: exam.examQuestionIds ?? [],
        examId: exam.examId,
      });
    }
    return exam.examId;
  } catch (error) {
    if (isTransactionsUnsupportedError(error)) throw error;
    if (isExamCreationAborted(error)) {
      if (error.promptIds.length > 0 || promptIds.length === 0) throw error;
      throw new ExamCreationAborted(error.message, {
        promptIds,
        examQuestionIds: error.examQuestionIds,
        examId: error.examId,
      });
    }
    throw new ExamCreationAborted("Failed to create exam", { promptIds });
  }
}

async function discardTracked<TSession>(
  ports: ExamCreationPorts<TSession>,
  aborted: ExamCreationAborted,
): Promise<void> {
  const promptIds = uniqueIds(aborted.promptIds);
  const examQuestionIds = uniqueIds(aborted.examQuestionIds);
  if (promptIds.length > 0) {
    try {
      await ports.deletePrompts(promptIds);
    } catch (error) {
      console.error("Failed to delete orphan prompts after exam creation failed:", error);
    }
  }
  if (examQuestionIds.length > 0) {
    try {
      await ports.deleteExamQuestions(examQuestionIds);
    } catch (error) {
      console.error("Failed to delete orphan exam questions after exam creation failed:", error);
    }
  }
}

function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids.filter((id) => id.length > 0))];
}
