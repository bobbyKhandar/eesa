"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import Link from "next/link"
import { Search } from "lucide-react"
import { Button } from "@/frontend/components/ui/button"
import { Input } from "@/frontend/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/frontend/components/ui/dialog"
import { searchCatalog, type SearchResult } from "@/frontend/lib/globalSearch"

export function GlobalSearch() {
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const [searchedQuery, setSearchedQuery] = useState("")
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<SearchResult[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!query.trim()) return
    controller.current?.abort()
    const current = new AbortController()
    controller.current = current
    setOpen(true)
    setSearchedQuery(query.trim())
    setLoading(true)
    setResults([])
    setErrors([])
    try {
      const response = await searchCatalog(query, current.signal)
      if (!current.signal.aborted) { setResults(response.results); setErrors(response.errors) }
    } catch {
      if (!current.signal.aborted) setErrors(["Search failed. Please try again."])
    } finally {
      if (!current.signal.aborted) setLoading(false)
    }
  }
  function close(next: boolean) {
    setOpen(next)
    if (!next) { controller.current?.abort(); setLoading(false) }
  }
  const form = (inDialog = false) => (
    <form onSubmit={submit} className="flex gap-2" role="search">
      <Input aria-label="Search exams, subjects, resources" placeholder="Search exams, subjects, resources..." value={query} onChange={event => setQuery(event.target.value)} autoFocus={inDialog} />
      <Button type="submit" size="sm" aria-label="Search" disabled={!query.trim()}><Search className="h-4 w-4" /></Button>
    </form>
  )
  return (
    <Dialog open={open} onOpenChange={close}>
      <div className="flex-1 max-w-md mx-4 hidden md:block">{form()}</div>
      <Button variant="ghost" size="sm" className="md:hidden" aria-label="Open search" onClick={() => setOpen(true)}><Search className="h-5 w-5" /></Button>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogTitle>Search</DialogTitle>
        <DialogDescription>Find exams, subjects, and resource question banks.</DialogDescription>
        {form(true)}
        <div role="status" aria-live="polite">
          {loading ? "Searching..." : searchedQuery && `${results.length} results for “${searchedQuery}”`}
        </div>
        {errors.map(error => <p key={error} role="alert" className="text-sm text-red-600">{error}</p>)}
        {!loading && searchedQuery && results.length === 0 && errors.length === 0 && <p>No matches found. Try another search.</p>}
        <ul className="space-y-2">
          {results.map(result => <li key={result.key}><Link href={result.href} onClick={() => close(false)} className="block rounded border p-3 hover:bg-muted focus-visible:ring-2"><span className="block font-medium">{result.title}</span><span className="text-sm text-muted-foreground">{result.category}</span></Link></li>)}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
