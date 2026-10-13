/**
 * Which resource lists the /resources page shows, and what its search box queries.
 *
 * The type select used to update local state that nothing else read, so Previous
 * Papers, Faculty Notes, and Student Notes always rendered the same lists. Search
 * was labelled as if it covered every resource, while it only compared previous-paper
 * text.
 */

export const RESOURCE_SECTIONS = ["pyqs", "faculty", "student"] as const;

export type ResourceSection = (typeof RESOURCE_SECTIONS)[number];

const SECTION_LABELS: Record<ResourceSection, string> = {
  pyqs: "previous papers",
  faculty: "faculty notes",
  student: "student notes",
};

export function isResourceSection(value: string): value is ResourceSection {
  return (RESOURCE_SECTIONS as readonly string[]).includes(value);
}

/** A specific type shows that list. Anything else, including "all", shows every list. */
export function visibleResourceSections(filterType: string): ResourceSection[] {
  if (isResourceSection(filterType)) return [filterType];
  return [...RESOURCE_SECTIONS];
}

/**
 * The list on screen. A chosen type wins over a leftover tab; with every type
 * visible, the open tab is the list search applies to.
 */
export function activeResourceSection(filterType: string, currentTab: string): ResourceSection {
  const sections = visibleResourceSections(filterType);
  if (isResourceSection(currentTab) && sections.includes(currentTab)) return currentTab;
  return sections[0];
}

function includesQuery(values: Array<string | null | undefined>, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return values.some((value) => (value ?? "").toLowerCase().includes(needle));
}

export interface PyqSearchFields {
  title?: string | null;
  questionText?: string | null;
  topic?: string | null;
}

export function filterPyqsByQuery<T extends PyqSearchFields>(pyqs: readonly T[], query: string): T[] {
  return pyqs.filter((pyq) => includesQuery([pyq.title, pyq.questionText, pyq.topic], query));
}

export interface NoteSearchFields {
  title?: string | null;
  description?: string | null;
  uploadedBy?: string | null;
  tags?: readonly string[] | null;
}

export function filterNotesByQuery<T extends NoteSearchFields>(notes: readonly T[], query: string): T[] {
  return notes.filter((note) =>
    includesQuery([note.title, note.description, note.uploadedBy, ...(note.tags ?? [])], query)
  );
}

export function resourceSearchPlaceholder(section: ResourceSection): string {
  return `Search ${SECTION_LABELS[section]}`;
}

export function resourceScopeMessage(filterType: string, section: ResourceSection): string {
  if (isResourceSection(filterType)) {
    return `Showing ${SECTION_LABELS[filterType]} only. Search applies to this list.`;
  }
  return `Showing all resource types. Search applies to ${SECTION_LABELS[section]}.`;
}

export function resourceEmptyMessage(section: ResourceSection, query: string): string {
  const label = SECTION_LABELS[section];
  const trimmed = query.trim();
  if (trimmed) return `No ${label} match "${trimmed}".`;
  return `No ${label} to show.`;
}
