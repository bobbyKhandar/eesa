/**
 * Load state for one section of the subject question-bank page.
 *
 * A failed request used to clear the list, and the page then rendered the
 * empty-catalog copy. Error has to win over a zero-length list so a network
 * or API failure is not shown as "nothing published yet".
 */

export type SubjectCatalogSection = "reports" | "unique-questions";

export type SubjectCatalogView = "loading" | "error" | "empty" | "ready";

const SECTION_LABEL: Record<SubjectCatalogSection, string> = {
  reports: "reports",
  "unique-questions": "unique questions",
};

export function subjectCatalogView(input: {
  loading: boolean;
  error: string | null | undefined;
  itemCount: number;
}): SubjectCatalogView {
  if (input.loading) return "loading";
  if (typeof input.error === "string" && input.error.trim().length > 0) return "error";
  if (input.itemCount <= 0) return "empty";
  return "ready";
}

/**
 * Keep a useful HTTP failure ("Failed to load reports (503)").
 * A bare "Failed to fetch" does not say which section broke.
 */
export function subjectCatalogErrorMessage(
  section: SubjectCatalogSection,
  cause: unknown,
): string {
  const fallback = `Unable to load ${SECTION_LABEL[section]}. Check your connection and try again.`;
  if (!(cause instanceof Error)) return fallback;

  const message = cause.message.trim();
  if (!message || /^failed to fetch$/i.test(message) || /^networkerror/i.test(message)) {
    return fallback;
  }
  return message;
}
