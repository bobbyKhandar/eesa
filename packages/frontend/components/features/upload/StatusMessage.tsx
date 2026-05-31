export function StatusMessage({ message }: { message: string }) {
  if (!message) return null

  const style = message.startsWith("✓")
    ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300"
    : message.startsWith("✗")
    ? "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300"
    : message.startsWith("📋")
    ? "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300"
    : "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"

  return <div className={`mt-4 p-4 rounded ${style}`}>{message}</div>
}
