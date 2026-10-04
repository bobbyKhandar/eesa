"use client"

import { useRef, useState, type FormEvent } from "react"
import { useUser } from "@clerk/nextjs"
import { Button } from "@/frontend/components/ui/button"
import { Input } from "@/frontend/components/ui/input"
import { Label } from "@/frontend/components/ui/label"
import { Textarea } from "@/frontend/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/frontend/components/ui/dialog"

export function UploadResourceDialog({ subject = "", onUploaded }: { subject?: string; onUploaded?: () => void } = {}) {
  const { isSignedIn } = useUser()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const busy = useRef(false)
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy.current || !isSignedIn) return
    const form = event.currentTarget
    const data = new FormData(form)
    const file = data.get("file") as File | null
    if (!file?.size) { setError("Choose a non-empty PDF or text file."); return }
    if (file.size > 10 * 1024 * 1024) { setError("Files must be 10 MB or smaller."); return }
    busy.current = true
    setLoading(true)
    setError(null)
    try {
      const response = await fetch("/api/notes", { method: "POST", body: data })
      const result = await response.json().catch(() => null)
      if (!response.ok || !result?.success) throw new Error(result?.error || "Upload failed. Please try again.")
      form.reset()
      setOpen(false)
      setSuccess(true)
      onUploaded?.()
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Upload failed. Please try again.") }
    finally { busy.current = false; setLoading(false) }
  }
  return (
    <div>
      <Dialog open={open} onOpenChange={next => { if (!loading) { setOpen(next); setError(null) } }}>
        <DialogTrigger asChild><Button disabled={!isSignedIn} onClick={() => setSuccess(false)}>Upload Resource</Button></DialogTrigger>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Upload Resource</DialogTitle><DialogDescription>Share a PDF or UTF-8 text note, up to 10 MB, with signed-in students.</DialogDescription></DialogHeader>
          <form onSubmit={upload} className="space-y-4">
            <div className="grid gap-2"><Label htmlFor="note-title">Title</Label><Input id="note-title" name="title" required maxLength={120} /></div>
            <div className="grid gap-2"><Label htmlFor="note-subject">Subject</Label><Input id="note-subject" name="subject" required maxLength={120} defaultValue={subject} /></div>
            <div className="grid gap-2"><Label htmlFor="note-description">Description</Label><Textarea id="note-description" name="description" maxLength={2000} /></div>
            <div className="grid gap-2"><Label htmlFor="note-file">File</Label><Input id="note-file" name="file" type="file" accept=".pdf,.txt" required /></div>
            <div className="grid gap-2"><Label htmlFor="note-tags">Tags (up to 10, comma separated)</Label><Input id="note-tags" name="tags" /></div>
            {error && <p role="alert" className="text-red-600">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>{loading ? "Uploading..." : "Upload Resource"}</Button>
          </form>
        </DialogContent>
      </Dialog>
      {success && <p role="status" className="text-sm">Resource uploaded. It is available in Shared Notes.</p>}
      {!isSignedIn && <p className="text-sm">Sign in to upload resources.</p>}
    </div>
  )
}
