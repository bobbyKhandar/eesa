/**
 * Publication rule for the public question bank.
 *
 * Exam creation writes prompts into the shared Prompt collection before an
 * exam is published. Those rows are stored with `generateVia: "user"` and are
 * not copied onto a public analysis report. Published bank prompts come from
 * OCR, Bedrock, or the analysis publish flow, which persist a different
 * `generateVia`. The unauthenticated question-bank fallback must apply this
 * filter or it returns unpublished exam text whenever UniqueQuestions is empty.
 */

export interface QuestionBankPrompt {
  generateVia?: unknown;
}

/** Exam drafts are the only prompts written with `generateVia: "user"`. */
export function isPublicQuestionBankPrompt(prompt: QuestionBankPrompt): boolean {
  return prompt.generateVia !== "user";
}

export function publicQuestionBankPrompts<T extends QuestionBankPrompt>(prompts: T[]): T[] {
  return prompts.filter(isPublicQuestionBankPrompt);
}

/** Mongo filter used by the public subject fallback. Missing `generateVia` stays included. */
export function publicPromptSubjectQuery(subject: string): {
  subject: string;
  generateVia: { $ne: "user" };
} {
  return {
    subject,
    generateVia: { $ne: "user" },
  };
}
