"use client"

type Datum = { name: string; value: number; color?: string }

export default function DistributionChart({
  data,
  showLegend = true,
}: {
  data: Datum[]
  showLegend?: boolean
}) {
  const total = data.reduce((acc, d) => acc + d.value, 0) || 1
  const sorted = [...data].sort((a, b) => b.value - a.value)

  return (
    <div className="flex flex-col gap-4">
      {/* Bars */}
      <div className="space-y-2">
        {sorted.map((d) => {
          const pct = Math.round((d.value / total) * 100)
          return (
            <div key={d.name} className="w-full">
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="font-medium">{d.name}</span>
                <span className="text-muted-foreground">{pct}%</span>
              </div>
              <div className="h-3 w-full rounded-full bg-muted">
                <div
                  className="h-3 rounded-full"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: d.color ?? "hsl(220 90% 56%)",
                  }}
                  aria-label={`${d.name} ${pct}%`}
                />
              </div>
            </div>
          )
        })}
      </div>

      {/* Legend */}
      {showLegend && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {sorted.map((d) => {
            const pct = Math.round((d.value / total) * 100)
            return (
              <div key={d.name} className="flex items-center gap-2 text-xs">
                <span
                  className="inline-block h-2 w-2 rounded"
                  style={{ backgroundColor: d.color ?? "hsl(220 90% 56%)" }}
                  aria-hidden
                />
                <span className="truncate">{d.name}</span>
                <span className="ml-auto tabular-nums text-muted-foreground">{pct}%</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
