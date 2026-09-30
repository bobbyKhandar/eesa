import { redirect } from "next/navigation";

/**
 * `/subjects-question-bank` was a byte-identical copy of `/subjects` (the
 * sidebar only ever linked to `/subjects`), so both routes served the same
 * catalog under two URLs. Redirect to the canonical page.
 */
export default function SubjectsQuestionBankRedirect() {
  redirect("/subjects");
}