export interface AdminExamRow {
  id: string;
  title: string;
  subject: string;
  duration: number | null;
  assignedCount: number;
  createdBy: string;
  scheduledAt: string | null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * One real exam document, ready for the admin table.
 * Rows without an id or a title are dropped so a partial document cannot
 * render as a blank or invented exam.
 */
export function toAdminExamRow(exam: unknown): AdminExamRow | null {
  if (!exam || typeof exam !== "object") return null;
  const record = exam as Record<string, unknown>;
  const id = record._id == null ? "" : String(record._id);
  const title = text(record.examTitle);
  if (!id || !title) return null;

  const duration =
    typeof record.duration === "number" && Number.isFinite(record.duration)
      ? record.duration
      : null;

  let scheduledAt: string | null = null;
  if (record.scheduledAt instanceof Date) {
    scheduledAt = record.scheduledAt.toISOString();
  } else if (typeof record.scheduledAt === "string" && record.scheduledAt.trim()) {
    scheduledAt = record.scheduledAt.trim();
  }

  return {
    id,
    title,
    subject: text(record.subject),
    duration,
    assignedCount: Array.isArray(record.assignedUsers) ? record.assignedUsers.length : 0,
    createdBy: text(record.createdBy),
    scheduledAt,
  };
}

export function filterAdminExams(exams: AdminExamRow[], search: string): AdminExamRow[] {
  const needle = search.trim().toLowerCase();
  if (!needle) return exams;
  return exams.filter((exam) =>
    exam.title.toLowerCase().includes(needle) || exam.subject.toLowerCase().includes(needle),
  );
}
