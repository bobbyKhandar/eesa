"use client"

import { useCallback, useEffect, useState } from "react"
import { useUser } from "@clerk/nextjs"
import { Button } from "@/frontend/components/ui/button"
import { Input } from "@/frontend/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/frontend/components/ui/card"

interface SharedNote { id: string; title: string; description: string; subject: string; tags: string[]; uploadedBy: string; uploadDate: string; fileSize: number }
export function SharedNotes({ refreshKey = 0 }: { refreshKey?: number }) {
  const { isLoaded, isSignedIn } = useUser()
  const [notes, setNotes] = useState<SharedNote[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError(null)
    try {
      const response = await fetch("/api/notes", { signal, cache: "no-store" })
      const data = await response.json()
      if (!response.ok || !data.success || !Array.isArray(data.notes)) throw new Error("Could not load shared notes.")
      if (!signal?.aborted) setNotes(data.notes)
    } catch (failure) { if (!signal?.aborted) setError(failure instanceof Error ? failure.message : "Could not load notes.") }
    finally { if (!signal?.aborted) setLoading(false) }
  }, [])
  useEffect(() => {
    if (!isLoaded) return
    if (!isSignedIn) { setNotes([]); setLoading(false); return }
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [isLoaded, isSignedIn, refreshKey, load])
  const filtered = notes.filter(note => [note.title, note.subject, note.description, ...note.tags].some(value => value.toLowerCase().includes(query.trim().toLowerCase())))
  return <section className="space-y-4"><h2 className="text-2xl font-bold">Shared Notes</h2><p className="text-muted-foreground">The latest 100 notes shared by signed-in users.</p><Input aria-label="Search shared notes" placeholder="Search titles, subjects and tags" value={query} onChange={event => setQuery(event.target.value)} />{loading ? <p role="status">Loading shared notes...</p> : error ? <div><p role="alert">{error}</p><Button onClick={() => void load()}>Retry</Button></div> : !isSignedIn ? <p>Sign in to view shared notes.</p> : filtered.length === 0 ? <p>No shared notes match. Upload a resource to share your notes.</p> : <div className="grid gap-4 md:grid-cols-2">{filtered.map(note => <Card key={note.id}><CardHeader><CardTitle>{note.title}</CardTitle></CardHeader><CardContent className="space-y-2"><p>{note.subject} · {note.uploadedBy}</p><p>{note.description}</p><p className="text-sm text-muted-foreground">{new Date(note.uploadDate).toLocaleDateString()} · {(note.fileSize / 1024).toFixed(1)} KB</p><p className="text-sm">{note.tags.join(", ")}</p><div className="flex gap-4"><a className="underline" href={`/api/notes/${encodeURIComponent(note.id)}/file`}>Download</a><a className="underline" href={`/api/notes/${encodeURIComponent(note.id)}/file?preview=1`} target="_blank" rel="noopener noreferrer">Preview</a></div></CardContent></Card>)}</div>}</section>
}
