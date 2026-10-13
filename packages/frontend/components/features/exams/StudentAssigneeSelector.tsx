"use client"

import { useEffect, useMemo, useState } from "react"
import { Input } from "@/frontend/components/ui/input"
import { Label } from "@/frontend/components/ui/label"
import { filterAssignableStudents, type AssignableStudent } from "@/frontend/lib/examCreation"

interface StudentAssigneeSelectorProps {
  selectedIds: string[]
  onChange: (ids: string[]) => void
  disabled?: boolean
}

export function StudentAssigneeSelector({ selectedIds, onChange, disabled }: StudentAssigneeSelectorProps) {
  const [students, setStudents] = useState<AssignableStudent[]>([])
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    const controller = new AbortController()
    let active = true

    const load = async () => {
      try {
        setLoading(true)
        setError("")
        const response = await fetch("/api/users/students", {
          signal: controller.signal,
          cache: "no-store",
        })
        const body = await response.json()
        if (!response.ok || !body.success) {
          throw new Error(body.error || "Failed to load students")
        }
        if (active) setStudents(Array.isArray(body.students) ? body.students : [])
      } catch (cause: any) {
        if (!active || controller.signal.aborted) return
        setError(cause.message || "Failed to load students")
      } finally {
        if (active) setLoading(false)
      }
    }

    load()

    return () => {
      active = false
      controller.abort()
    }
  }, [])

  const visible = useMemo(() => filterAssignableStudents(students, query), [students, query])
  const selected = useMemo(() => new Set(selectedIds), [selectedIds])
  const allVisibleSelected = visible.length > 0 && visible.every((student) => selected.has(student.id))

  const toggle = (id: string) => {
    if (disabled) return
    if (selected.has(id)) {
      onChange(selectedIds.filter((current) => current !== id))
      return
    }
    onChange([...selectedIds, id])
  }

  const toggleVisible = () => {
    if (disabled) return
    if (allVisibleSelected) {
      const visibleIds = new Set(visible.map((student) => student.id))
      onChange(selectedIds.filter((id) => !visibleIds.has(id)))
      return
    }
    const merged = [...selectedIds]
    for (const student of visible) {
      if (!selected.has(student.id)) merged.push(student.id)
    }
    onChange(merged)
  }

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor="student-search">Assign to students *</Label>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {selectedIds.length} selected
        </span>
      </div>
      <Input
        id="student-search"
        value={query}
        disabled={disabled || loading}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search students by name or email"
      />
      {loading && <p className="text-sm text-gray-500 dark:text-gray-400">Loading students…</p>}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!loading && !error && students.length === 0 && (
        <p className="text-sm text-gray-500 dark:text-gray-400">No students are available to assign.</p>
      )}
      {!loading && !error && students.length > 0 && (
        <div className="rounded-md border border-gray-200 dark:border-gray-800">
          <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2 dark:border-gray-800">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                disabled={disabled || visible.length === 0}
                onChange={toggleVisible}
                className="h-4 w-4 rounded border-gray-300"
              />
              Select visible
            </label>
            <button
              type="button"
              className="text-xs text-gray-500 underline disabled:opacity-50 dark:text-gray-400"
              disabled={disabled || selectedIds.length === 0}
              onClick={() => onChange([])}
            >
              Clear
            </button>
          </div>
          <ul className="max-h-60 overflow-y-auto">
            {visible.length === 0 && (
              <li className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">No students match that search.</li>
            )}
            {visible.map((student) => (
              <li key={student.id} className="border-t border-gray-100 first:border-t-0 dark:border-gray-800">
                <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.has(student.id)}
                    disabled={disabled}
                    onChange={() => toggle(student.id)}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <span>
                    <span className="font-medium">{student.name}</span>
                    <span className="ml-2 text-gray-500 dark:text-gray-400">{student.email}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Selected students are assigned this exam. A submission deadline still keeps it closed until that time.
      </p>
    </div>
  )
}
