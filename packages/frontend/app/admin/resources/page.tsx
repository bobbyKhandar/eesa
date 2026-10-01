"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/frontend/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/frontend/components/ui/table"

interface CatalogSubject {
  id: string
  name: string
  code: string
  branch: string
  reportCount: number
  questionCount: number
}

export default function AdminResources() {
  const [subjects, setSubjects] = useState<CatalogSubject[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const response = await fetch("/api/resources?action=subjects")
        const data = await response.json().catch(() => null)
        if (!response.ok || !data?.success) {
          throw new Error(data?.error || "Failed to load the catalog")
        }
        const rows = Array.isArray(data.data?.subjects) ? data.data.subjects : []
        if (active) setSubjects(rows)
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Failed to load the catalog")
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Resources</h1>
        <p className="text-muted-foreground">Subjects that have published reports</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Catalog</CardTitle>
          <CardDescription>
            {loading ? "Loading…" : `${subjects.length} subject${subjects.length === 1 ? "" : "s"}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!loading && !error && subjects.length === 0 && (
            <p className="text-sm text-muted-foreground">No published subjects yet.</p>
          )}
          {subjects.length > 0 && (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Subject</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead>Reports</TableHead>
                    <TableHead>Questions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subjects.map((subject) => (
                    <TableRow key={subject.id || `${subject.branch}-${subject.code}-${subject.name}`}>
                      <TableCell className="font-medium">{subject.name}</TableCell>
                      <TableCell>{subject.code || "—"}</TableCell>
                      <TableCell>{subject.branch || "—"}</TableCell>
                      <TableCell>{subject.reportCount ?? 0}</TableCell>
                      <TableCell>{subject.questionCount ?? 0}</TableCell>
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
