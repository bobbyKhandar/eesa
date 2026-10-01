"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/frontend/components/ui/card"
import { Input } from "@/frontend/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/frontend/components/ui/table"
import { Search } from "lucide-react"
import { filterAdminExams, type AdminExamRow } from "@/frontend/lib/adminExamList"

export default function AdminExams() {
  const [searchTerm, setSearchTerm] = useState("")
  const [exams, setExams] = useState<AdminExamRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        setLoading(true)
        const response = await fetch("/api/admin/exams")
        const data = await response.json().catch(() => null)
        if (!response.ok || !data?.success) {
          throw new Error(data?.error || "Failed to load exams")
        }
        if (active) {
          setExams(Array.isArray(data.exams) ? data.exams : [])
          setError(null)
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Failed to load exams")
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [])

  const visible = filterAdminExams(exams, searchTerm)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Exams</h1>
        <p className="text-muted-foreground">Exams stored in the database</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All exams</CardTitle>
          <CardDescription>
            {loading ? "Loading…" : `${exams.length} exam${exams.length === 1 ? "" : "s"}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative mb-6 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by title or subject"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              className="pl-8"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          {!loading && !error && visible.length === 0 && (
            <p className="text-sm text-muted-foreground">No exams match this search.</p>
          )}

          {visible.length > 0 && (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Subject</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Assigned</TableHead>
                    <TableHead>Scheduled</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((exam) => (
                    <TableRow key={exam.id}>
                      <TableCell className="font-medium">{exam.title}</TableCell>
                      <TableCell>{exam.subject || "—"}</TableCell>
                      <TableCell>{exam.duration == null ? "—" : `${exam.duration} min`}</TableCell>
                      <TableCell>{exam.assignedCount}</TableCell>
                      <TableCell>{exam.scheduledAt ? exam.scheduledAt.slice(0, 10) : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
