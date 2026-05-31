export function getStatusColor(status: string) {
  switch (status) {
    case "success": return "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300"
    case "failed": return "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300"
    case "partial_success": return "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300"
    case "in_progress": return "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
    default: return "bg-gray-100 dark:bg-gray-900/30 text-gray-700 dark:text-gray-300"
  }
}

export function getStatusIcon(status: string) {
  switch (status) {
    case "success": return "✓"
    case "failed": return "✗"
    case "in_progress": return "◌"
    default: return "○"
  }
}

export function getStageStatusSummary(stages: Record<string, { status: string }> | undefined) {
  if (!stages) return "Unknown"
  const stageList = ["ocr", "parsing", "enrichment", "organization"]
  const completed = stageList.filter(s => stages[s]?.status === "success").length
  return `${completed}/4 stages completed`
}
