"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useUser } from "@clerk/nextjs"
import { Button } from "@/frontend/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/frontend/components/ui/card"
import { calculateSubjectPerformance, summarizeResults, type DateFilter, type ResultRow } from "@/frontend/lib/examResults"
import { analyticsCsv, analyticsReport, downloadAnalytics, filterAnalytics } from "@/frontend/lib/performanceAnalytics"

export default function AnalyticsPage() {
  const { isLoaded, isSignedIn } = useUser()
  const [rows, setRows] = useState<ResultRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [subject, setSubject] = useState("all")
  const [date, setDate] = useState<DateFilter>("all")
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch("/api/results", { signal, cache: "no-store" })
      const data = await response.json()
      if (!response.ok || !data.success || !Array.isArray(data.data?.results)) throw new Error("Could not load your performance data.")
      if (!signal?.aborted) setRows(data.data.results)
    } catch (failure) {
      if (!signal?.aborted) setError(failure instanceof Error ? failure.message : "Could not load analytics.")
    } finally { if (!signal?.aborted) setLoading(false) }
  }, [])
  useEffect(() => {
    if (!isLoaded) return
    if (!isSignedIn) { setRows([]); setLoading(false); return }
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [isLoaded, isSignedIn, load])
  const filtered = filterAnalytics(rows, subject, date)
  const stats = summarizeResults(filtered)
  const subjects = Array.from(new Set(rows.map(row => row.subject))).sort()
  const performance = calculateSubjectPerformance(filtered)
  const canExport = isSignedIn && !loading && !error && filtered.length > 0

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between gap-4"><div><h1 className="text-3xl font-bold">Your Performance Analytics</h1><p className="text-muted-foreground">Metrics from your exam results. Filters also apply to downloads.</p></div><div className="flex flex-wrap gap-2"><Button disabled={!canExport} onClick={() => downloadAnalytics(analyticsCsv(filtered), "exam-performance.csv", "text/csv;charset=utf-8")}>Export Data</Button><Button variant="outline" disabled={!canExport} onClick={() => downloadAnalytics(analyticsReport(filtered, subject, date), "performance-report.txt", "text/plain;charset=utf-8")}>Generate Report</Button></div></div>
      <div className="flex flex-wrap gap-4">
        <label className="grid gap-1">Subject<select aria-label="Subject filter" className="rounded border p-2 bg-background" value={subject} onChange={event => setSubject(event.target.value)}><option value="all">All subjects</option>{subjects.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <label className="grid gap-1">Date range<select aria-label="Date range" className="rounded border p-2 bg-background" value={date} onChange={event => setDate(event.target.value as DateFilter)}><option value="all">All time</option><option value="week">Last 7 days</option><option value="month">Last 30 days</option><option value="semester">Last 120 days</option></select></label>
      </div>
      {loading ? <p role="status">Loading analytics...</p> : error ? <div><p role="alert">{error}</p><Button onClick={() => void load()}>Retry</Button></div> : !isSignedIn ? <p>Sign in to view your analytics.</p> : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[["Exams", stats.totalExams], ["Average score", `${stats.avgScore}%`], ["Passed exams", stats.passedExams], ["Pass rate", `${stats.passRate}%`]].map(([title, value]) => <Card key={title}><CardHeader><CardTitle className="text-sm">{title}</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{value}</CardContent></Card>)}</div>
          {filtered.length === 0 ? <p>No results match these filters.</p> : <>
            <Card><CardHeader><CardTitle>Performance by subject</CardTitle></CardHeader><CardContent className="space-y-3">{performance.map(item => <div key={item.subject}><p>{item.subject}: {item.score}% average across {item.count} exams</p><progress aria-label={`${item.subject} average score`} className="w-full" max={100} value={item.score} /></div>)}</CardContent></Card>
            <div className="overflow-x-auto"><table className="w-full text-left"><caption className="text-left font-semibold mb-2">Filtered exam results</caption><thead><tr>{["Exam", "Subject", "Score", "Percentage", "Status"].map(title => <th key={title} className="p-2">{title}</th>)}</tr></thead><tbody>{filtered.map(row => <tr key={row.id} className="border-t"><td className="p-2"><Link href={`/results/${encodeURIComponent(row.id)}`} className="underline">{row.examName}</Link></td><td className="p-2">{row.subject}</td><td className="p-2">{row.score}/{row.totalMarks}</td><td className="p-2">{row.percentage.toFixed(1)}%</td><td className="p-2">{row.status}</td></tr>)}</tbody></table></div>
          </>}
        </>
      )}
    </div>
  )
}
