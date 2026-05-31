import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/frontend/components/ui/card"
import { Button } from "@/frontend/components/ui/button"
import { Badge } from "@/frontend/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/frontend/components/ui/table"
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

interface PyqsTableProps {
  subjectName: string
  pyqs: PYQ[]
  loading: boolean
  getDifficultyColor: (d: string) => string
}

export function PyqsTable({ subjectName, pyqs, loading, getDifficultyColor }: PyqsTableProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Previous Year Question Papers</CardTitle>
          <Button variant="outline" size="sm" className="gap-1 bg-transparent">
            <Download className="h-4 w-4" /> Download All
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
            No PYQs available for {subjectName}
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
                {pyqs.map((pyq) => (
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
                      <Button variant="ghost" size="sm">
                        <Eye className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
