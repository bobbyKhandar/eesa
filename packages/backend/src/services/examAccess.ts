export interface AccessDecision {
  allowed: boolean;
  status: number;
  error?: string;
}

export interface ExamContentDecision extends AccessDecision {
  revealAnswerKey: boolean;
}

/**
 * Destructive admin actions require a signed-in user whose stored role is admin.
 * A missing session is 401. Any other role is 403.
 */
export function adminAccessDecision(input: {
  callerId: string | null;
  callerRole?: string | null;
}): AccessDecision {
  if (!input.callerId) {
    return { allowed: false, status: 401, error: "Unauthorized" };
  }
  if (input.callerRole !== "admin") {
    return { allowed: false, status: 403, error: "Admin authorization required" };
  }
  return { allowed: true, status: 200 };
}

/**
 * Profile creation from the client can never grant admin or teacher.
 * Role changes for existing accounts are not performed by this path.
 */
export function resolveSelfServiceRole(_requestedRole: unknown): "student" {
  return "student";
}

export function selfUserWriteDecision(
  callerId: string | null,
  targetId: string | null
): AccessDecision {
  if (!callerId) {
    return { allowed: false, status: 401, error: "Unauthorized" };
  }
  if (!targetId || callerId !== targetId) {
    return { allowed: false, status: 403, error: "Forbidden" };
  }
  return { allowed: true, status: 200 };
}

/**
 * Question content requires an authenticated examinee assigned to the exam,
 * the exam creator, or an admin. Answer keys are revealed only to the creator
 * and admins; assigned examinees receive a stripped payload.
 */
export function examContentAccessDecision(input: {
  callerId: string | null;
  callerRole?: string | null;
  assignedUsers?: string[] | null;
  createdBy?: string | null;
}): ExamContentDecision {
  if (!input.callerId) {
    return { allowed: false, status: 401, error: "Unauthorized", revealAnswerKey: false };
  }
  const isAdmin = input.callerRole === "admin";
  const isCreator = !!input.createdBy && input.createdBy === input.callerId;
  const isAssigned = (input.assignedUsers ?? []).includes(input.callerId);
  if (!isAdmin && !isCreator && !isAssigned) {
    return {
      allowed: false,
      status: 403,
      error: "You are not assigned to this exam",
      revealAnswerKey: false,
    };
  }
  return { allowed: true, status: 200, revealAnswerKey: isAdmin || isCreator };
}

export function submissionAccessDecision(input: {
  callerId: string | null;
  callerRole?: string | null;
  submissionUserId?: string | null;
}): AccessDecision {
  if (!input.callerId) {
    return { allowed: false, status: 401, error: "Unauthorized" };
  }
  if (input.callerRole === "admin" || input.callerId === input.submissionUserId) {
    return { allowed: true, status: 200 };
  }
  return { allowed: false, status: 403, error: "You do not have access to this submission" };
}

function questionIdOf(question: { _id?: { toString(): string } | string }): string {
  if (question._id == null) return "";
  return typeof question._id === "string" ? question._id : question._id.toString();
}

function examineeOption(option: unknown): { text: string } {
  if (typeof option === "string") return { text: option };
  if (option && typeof option === "object" && "text" in option) {
    return { text: String((option as { text?: unknown }).text ?? "") };
  }
  return { text: "" };
}

function toExamineeQuestion(question: Record<string, any>) {
  return {
    _id: questionIdOf(question),
    questionText: question.promptData?.questionText || question.questionText || "",
    questionType: question.questionType,
    marks: typeof question.marks === "number" ? question.marks : 0,
    negativeMarks: question.negativeMarks,
    options: Array.isArray(question.options) ? question.options.map(examineeOption) : [],
  };
}

/**
 * Examinee exam payload. Drops answer keys, correctness flags, and the raw
 * questionDetails join so correct answers cannot be read from this response.
 */
export function toExamineeExam<T extends Record<string, any>>(exam: T) {
  const source = Array.isArray(exam.questionDetails)
    ? exam.questionDetails
    : Array.isArray(exam.questions)
      ? exam.questions
      : [];
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(exam)) {
    if (key === "questionDetails" || key === "questions" || key === "answer" || key === "correctAnswer") {
      continue;
    }
    rest[key] = value;
  }
  return {
    ...rest,
    questions: source.map((question: Record<string, any>) => toExamineeQuestion(question)),
  };
}
