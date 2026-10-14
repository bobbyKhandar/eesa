"use client"

import { useState } from "react"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/frontend/components/ui/card"
import { Button } from "@/frontend/components/ui/button"
import { Badge } from "@/frontend/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/frontend/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/frontend/components/ui/table"
import { describePyq, pyqsDownload, type PyqPreview } from "@/frontend/lib/pyqExport"
import { triggerTextDownload } from "@/frontend/lib/resultExport"
import { Download, Eye, Loader2 } from "lucide-react"

export interface PYQ {
  _id: string
  id?: string
  title: string
  questionText: string
  year?: string
  years?: string[]
  examType: string
  occurrenceCount: number
  frequency?: number
  bloomsLevel: string
  topic?: string
  topics?: string[]
  difficulty?: string
  downloadCount: number
  sourceReports: number
}

interface PyqPageControls {
  hasPrevious: boolean
  hasNext: boolean
  onPrevious: () => void
  onNext: () => void
  paging?: boolean
}

interface PyqsTableProps {
  subjectName: string
  pyqs: PYQ[]
  loading: boolean
  getDifficultyColor: (d: string) => string
  /** Replaces the default empty copy, for example when a search matches nothing. */
  emptyMessage?: string
  /** When set, the table is one page of the subject bank. */
  page?: PyqPageControls
}

const PREVIEW_FIELDS = [
  ["Year", "yearsLabel"],
  ["Frequency", "frequencyLabel"],
  ["Difficulty", "difficulty"],
  ["Bloom's level", "bloomsLevel"],
  ["Topics", "topicsLabel"],
  ["Exam type", "examType"],
] as const

export function PyqsTable({
  subjectName,
  pyqs,
  loading,
  getDifficultyColor,
  emptyMessage,
  page,
}: PyqsTableProps) {
  const [preview, setPreview] = useState<PyqPreview | null>(null)
  const anotherPage = Boolean(page && (page.hasPrevious || page.hasNext))
  const canDownload = !loading && !page?.paging && pyqs.length > 0

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Previous Year Question Papers</CardTitle>
          <Button
            variant="outline"
            size="sm"
            className="gap-1 bg-transparent"
            onClick={() => triggerTextDownload(pyqsDownload(pyqs, subjectName))}
            disabled={!canDownload}
            title={
              canDownload
                ? anotherPage
                  ? "Download this page as CSV"
                  : "Download the listed questions as CSV"
                : "No questions to download"
            }
          >
            <Download className="h-4 w-4" /> {anotherPage ? "Download page" : "Download All"}
          </Button>
        </div>
        <CardDescription>Access past examination papers for {subjectName}</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-gray-500" />
          </div>
        ) : pyqs.length === 0 ? (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            {emptyMessage ?? `No PYQs available for ${subjectName}`}
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Question</TableHead>
                  <TableHead>Year</TableHead>
                  <TableHead>Frequency</TableHead>
                  <TableHead>Difficulty</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pyqs.map((pyq) => {
                  const details = describePyq(pyq)
                  return (
                    <TableRow key={pyq._id}>
                      <TableCell>
                        <div className="max-w-md">
                          <div className="font-medium line-clamp-2">{pyq.questionText}</div>
                          {pyq.topics && pyq.topics.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {pyq.topics.slice(0, 3).map((topic, idx) => (
                                <Badge key={idx} variant="outline" className="text-xs">{topic}</Badge>
                              ))}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {pyq.years && pyq.years.length > 0 ? (
                          <div className="text-sm">{pyq.years.join(', ')}</div>
                        ) : (
                          <span className="text-gray-400">N/A</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{pyq.frequency || 0}×</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={getDifficultyColor(pyq.difficulty || 'medium')}>
                          {pyq.difficulty || 'Medium'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Preview ${details.title}`}
                          onClick={() => setPreview(details)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
        {page && !(loading && pyqs.length === 0) && (
          <nav aria-label="Previous year question pages" className="flex items-center justify-between pt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={page.onPrevious}
              disabled={!page.hasPrevious || page.paging}
            >
              Previous
            </Button>
            <p className="text-sm text-gray-500">
              {page.paging ? "Loading page..." : `${pyqs.length} on this page`}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={page.onNext}
              disabled={!page.hasNext || page.paging}
            >
              Next
            </Button>
          </nav>
        )}
      </CardContent>
      <Dialog
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open) setPreview(null)
        }}
      >
        {preview && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{preview.title}</DialogTitle>
              <DialogDescription>Previous-year question for {subjectName}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 text-sm">
              <p className="whitespace-pre-wrap">
                {preview.questionText || "No question text is available."}
              </p>
              <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
                {PREVIEW_FIELDS.filter(([, key]) => preview[key]).map(([label, key]) => (
                  <div key={key} className="contents">
                    <dt className="text-gray-500 dark:text-gray-400">{label}</dt>
                    <dd>{preview[key]}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </Card>
  )
}
