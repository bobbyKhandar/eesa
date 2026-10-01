export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Exams</h1>
      </div>
      {/* Previously returned null, so navigating in rendered a blank screen. */}
      <div className="space-y-4">
        {[0, 1, 2].map((row) => (
          <div
            key={row}
            className="h-32 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800"
            aria-hidden="true"
          />
        ))}
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400">Loading exams…</p>
    </div>
  )
}
