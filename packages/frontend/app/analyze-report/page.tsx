import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/frontend/components/ui/card"
import { Button } from "@/frontend/components/ui/button"
import { Badge } from "@/frontend/components/ui/badge"
import DistributionChart from "@/frontend/components/analysis/distribution-chart"

type SearchParams = { [key: string]: string | string[] | undefined }

export default function AnalysisReportPage({ searchParams }: { searchParams: SearchParams }) {
  const subject =
    typeof searchParams.subject === "string" && searchParams.subject.length > 0
      ? searchParams.subject
      : "Physics — Mechanics"
  const dateStr =
    typeof searchParams.date === "string" && searchParams.date.length > 0
      ? searchParams.date
      : new Date().toLocaleDateString(undefined, { month: "short", day: "2-digit", year: "numeric" })

  const chartData = [
    { name: "Recall", value: 18, color: "#0ea5e9" },
    { name: "Understand", value: 32, color: "#22c55e" },
    { name: "Apply", value: 28, color: "#f59e0b" },
    { name: "Analyze", value: 12, color: "#a855f7" },
    { name: "Evaluate", value: 6, color: "#ef4444" },
    { name: "Create", value: 4, color: "#6b7280" },
  ]

  const insights = {
    syllabusCoverage: {
      title: "Syllabus Coverage",
      status: "Strong coverage across core topics",
      detail: "82% of questions align with the selected syllabus outline",
      tone: "success" as const,
    },
    pastPaperComparison: {
      title: "Past-Paper Comparison",
      status: "Distribution is consistent with prior years",
      detail: "Deviation within ±5% across cognitive levels",
      tone: "neutral" as const,
    },
  }

  const rows = [
    {
      question: "State Newton's three laws of motion and provide a real-world example for each.",
      level: "Understand",
      levelColor: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
      justification: "Requires explanation and examples demonstrating comprehension rather than mere recall.",
    },
    {
      question:
        "A 5 kg block is pulled across a horizontal surface with a constant velocity using a force of 20 N. If the coefficient of kinetic friction is 0.3, calculate the normal force and frictional force.",
      level: "Apply",
      levelColor: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
      justification: "Involves substituting values into equations and applying F = μN to a novel scenario.",
    },
    {
      question:
        "Two carts collide elastically on a frictionless track. Given their masses and initial velocities, determine their final velocities and analyze the energy transfer.",
      level: "Analyze",
      levelColor: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
      justification: "Requires breaking the problem into momentum and energy components and analyzing interactions.",
    },
    {
      question:
        "Design an experiment to measure the coefficient of static friction between two materials using accessible lab equipment.",
      level: "Create",
      levelColor: "bg-slate-100 text-slate-800 dark:bg-slate-900/30 dark:text-slate-300",
      justification: "Students must propose a novel procedure and justify measurement strategy and controls.",
    },
    {
      question: "State the difference between mass and weight and identify the SI units for each.",
      level: "Recall",
      levelColor: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300",
      justification: "Direct definition and unit identification without explanation or application.",
    },
    {
      question:
        "Evaluate the validity of an energy conservation argument presented for a pendulum with air resistance.",
      level: "Evaluate",
      levelColor: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
      justification: "Requires judgement with criteria and evidence considering non-ideal conditions.",
    },
  ]

  return (
    <div className="mx-auto w-full max-w-7xl">
      {/* Header with actions */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">Analysis Report</h1>
          <p className="text-sm text-muted-foreground">
            Subject: <span className="font-medium text-foreground">{subject}</span> • Date:{" "}
            <span className="font-medium text-foreground">{dateStr}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="destructive">Delete</Button>
          <Button>Publish</Button>
        </div>
      </div>

      {/* Top grid: chart + insight cards */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Question Distribution by Classification Level</CardTitle>
            <CardDescription>Percentage of questions across Bloom&apos;s taxonomy levels</CardDescription>
          </CardHeader>
          <CardContent>
            <DistributionChart data={chartData} />
          </CardContent>
        </Card>

        <div className="grid gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{insights.syllabusCoverage.title}</CardTitle>
              <CardDescription>Optional analysis result</CardDescription>
            </CardHeader>
            <CardContent className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium">{insights.syllabusCoverage.status}</p>
                <p className="text-sm text-muted-foreground">{insights.syllabusCoverage.detail}</p>
              </div>
              <Badge variant="secondary" className="shrink-0">
                {insights.syllabusCoverage.tone === "success" ? "Pass" : "Info"}
              </Badge>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{insights.pastPaperComparison.title}</CardTitle>
              <CardDescription>Optional analysis result</CardDescription>
            </CardHeader>
            <CardContent className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium">{insights.pastPaperComparison.status}</p>
                <p className="text-sm text-muted-foreground">{insights.pastPaperComparison.detail}</p>
              </div>
              <Badge variant="outline" className="shrink-0">
                {insights.pastPaperComparison.tone === "neutral" ? "Aligned" : "Check"}
              </Badge>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Bottom: detailed results table */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Detailed Results</CardTitle>
          <CardDescription>Question-by-question breakdown with classification and AI justification</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full table-auto border-separate border-spacing-0">
            <thead>
              <tr className="[&>th]:bg-muted/50">
                <th
                  scope="col"
                  className="sticky left-0 z-10 border-b px-4 py-3 text-left text-xs font-medium uppercase tracking-wide"
                >
                  Question
                </th>
                <th scope="col" className="border-b px-4 py-3 text-left text-xs font-medium uppercase tracking-wide">
                  Classification
                </th>
                <th scope="col" className="border-b px-4 py-3 text-left text-xs font-medium uppercase tracking-wide">
                  AI Justification
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={idx} className="even:bg-muted/30">
                  <td className="sticky left-0 z-0 max-w-[520px] whitespace-pre-wrap px-4 py-3 align-top">
                    <p className="text-sm text-foreground">{row.question}</p>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${row.levelColor}`}>
                      {row.level}
                    </span>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <p className="text-sm text-muted-foreground">{row.justification}</p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
