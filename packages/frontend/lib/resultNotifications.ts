export interface ResultNotification { key: string; title: string; href: string; date: string }

export function resultNotifications(rows: unknown): ResultNotification[] {
  if (!Array.isArray(rows)) return []
  return rows.filter(row => row && typeof row.id === "string" && typeof row.examName === "string")
    .map(row => ({ key: `${row.id}:${row.score}:${row.totalMarks}`, title: `Exam result: ${row.examName}`, href: `/results/${encodeURIComponent(row.id)}`, date: typeof row.date === "string" ? row.date : "" }))
    .sort((left, right) => (Date.parse(right.date) || 0) - (Date.parse(left.date) || 0))
    .slice(0, 20)
}

export function parseReadNotifications(value: string | null): string[] {
  try {
    const data = JSON.parse(value || "[]")
    return Array.isArray(data) ? data.filter(item => typeof item === "string") : []
  } catch { return [] }
}

export function notificationStorageKey(userId: string): string { return `eesa:read-results:${userId}` }
