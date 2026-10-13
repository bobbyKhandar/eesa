"use client"

import type React from "react"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/frontend/components/ui/card"
import { Button } from "@/frontend/components/ui/button"
import { Input } from "@/frontend/components/ui/input"
import { Label } from "@/frontend/components/ui/label"
import { Textarea } from "@/frontend/components/ui/textarea"
import { Checkbox } from "@/frontend/components/ui/checkbox"
import { RadioGroup, RadioGroupItem } from "@/frontend/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/frontend/components/ui/select"
import { Upload, BookOpen } from "lucide-react"

export default function UploadPage() {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Form state
  const [docFile, setDocFile] = useState<File | null>(null)
  const [pastPaperComparison, setPastPaperComparison] = useState<boolean>(true)

  const [subject, setSubject] = useState("")
  const [year, setYear] = useState<string>("2025")
  const [semester, setSemester] = useState<string>("S1")
  const [examType, setExamType] = useState<"main" | "kt">("main")
  const [notes, setNotes] = useState("")

  const yearOptions = useMemo(() => {
    const now = new Date().getFullYear()
    return Array.from({ length: 10 }, (_, i) => String(now - i))
  }, [])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!docFile || subject.trim().length === 0) {
      alert("Please select a document and enter a subject.")
      return
    }
    setIsSubmitting(true)

    try {
      // Prepare form data for upload
      const formData = new FormData()
      formData.append("file", docFile)
      formData.append("subjectName", subject)
      formData.append("year", year)
      formData.append("semester", semester)
      formData.append("examType", examType)
      formData.append("userNotes", notes)
      formData.append("comparePastPapers", String(pastPaperComparison))

      // Upload and start analysis
      const response = await fetch("/api/exam-analysis/upload", {
        method: "POST",
        body: formData,
      })

      const data = await response.json()

      if (!data.success) {
        throw new Error(data.error || "Failed to upload exam")
      }

      // Redirect to analysis report page with analysisId
      router.push(`/analysis-report/${data.analysisId}`)
    } catch (error: any) {
      console.error("Error uploading exam:", error)
      alert(error.message || "Failed to upload exam. Please try again.")
      setIsSubmitting(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">Upload & Analyze</h1>
          <p className="text-sm text-muted-foreground">
            Upload an exam image/PDF/DOCX and provide metadata. You can compare its Bloom distribution with your earlier analyses.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => router.push("/ai-analyze-bulk")}
          className="whitespace-nowrap"
        >
          <Upload className="mr-2 h-4 w-4" />
          Bulk Upload
        </Button>
      </div>

      <form onSubmit={onSubmit} className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Document Upload
            </CardTitle>
            <CardDescription>Supported formats: images (PNG/JPG), PDF, DOC/DOCX</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="doc">Exam file</Label>
              <Input
                id="doc"
                type="file"
                accept=".pdf,.doc,.docx,image/*"
                onChange={(e) => setDocFile(e.target.files?.[0] ?? null)}
                aria-describedby="doc-help"
                required
              />
              <p id="doc-help" className="text-xs text-muted-foreground">
                Max 25MB. Ensure clear scans for best results.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="subject">Subject</Label>
              <Input
                id="subject"
                placeholder="e.g., Physics — Mechanics"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="year">Year</Label>
              <Select value={year} onValueChange={setYear}>
                <SelectTrigger id="year">
                  <SelectValue placeholder="Select year" />
                </SelectTrigger>
                <SelectContent>
                  {yearOptions.map((y) => (
                    <SelectItem key={y} value={y}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="semester">Semester</Label>
              <Select value={semester} onValueChange={setSemester}>
                <SelectTrigger id="semester">
                  <SelectValue placeholder="Select semester" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="S1">Semester 1</SelectItem>
                  <SelectItem value="S2">Semester 2</SelectItem>
                  <SelectItem value="S3">Semester 3</SelectItem>
                  <SelectItem value="S4">Semester 4</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label>Exam Type</Label>
              <RadioGroup
                value={examType}
                onValueChange={(v) => setExamType(v as "main" | "kt")}
                className="flex flex-wrap gap-4"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem id="main-type" value="main" />
                  <Label htmlFor="main-type">Main</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem id="kt-type" value="kt" />
                  <Label htmlFor="kt-type">KT / Backlog</Label>
                </div>
              </RadioGroup>
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Textarea
                id="notes"
                placeholder="Any extra context that could help the analysis..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="h-5 w-5" />
              Analysis Options
            </CardTitle>
            <CardDescription>Compare with earlier analyses</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="past-paper"
                    checked={pastPaperComparison}
                    onCheckedChange={(v) => setPastPaperComparison(Boolean(v))}
                  />
                  <Label htmlFor="past-paper">Compare with earlier analyses</Label>
                </div>
                <p className="text-xs text-muted-foreground">
                  Compare this exam&apos;s Bloom distribution with your completed or published analyses of the same subject.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => window.location.reload()}>
            Reset
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Analyzing..." : "Analyze"}
          </Button>
        </div>
      </form>
    </div>
  )
}
