"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useUser } from "@clerk/nextjs"
import { Bell } from "lucide-react"
import { Button } from "@/frontend/components/ui/button"
import { Badge } from "@/frontend/components/ui/badge"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/frontend/components/ui/dropdown-menu"
import { notificationStorageKey, parseReadNotifications, resultNotifications, type ResultNotification } from "@/frontend/lib/resultNotifications"

export function ResultNotifications() {
  const { user } = useUser()
  const userId = user?.id
  const [items, setItems] = useState<ResultNotification[]>([])
  const [open, setOpen] = useState(false)
  const [read, setRead] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const controller = useRef<AbortController | null>(null)
  const load = useCallback(async () => {
    if (!userId) return
    controller.current?.abort()
    const request = new AbortController()
    controller.current = request
    setLoading(true)
    setError(null)
    try {
      const response = await fetch("/api/results", { signal: request.signal, cache: "no-store" })
      const data = await response.json()
      if (!response.ok || !data.success || !Array.isArray(data.data?.results)) throw new Error("Results unavailable")
      if (!request.signal.aborted) setItems(resultNotifications(data.data.results))
    } catch {
      if (!request.signal.aborted) setError("Could not load notifications. Please retry.")
    } finally { if (!request.signal.aborted) setLoading(false) }
  }, [userId])

  useEffect(() => {
    setItems([])
    setRead([])
    setError(null)
    if (userId) {
      try { setRead(parseReadNotifications(localStorage.getItem(notificationStorageKey(userId)))) } catch { /* Device storage may be disabled. */ }
      void load()
    }
    return () => controller.current?.abort()
  }, [userId, load])

  function markRead(keys: string[]) {
    const next = Array.from(new Set([...read, ...keys])).filter(key => items.some(item => item.key === key))
    setRead(next)
    if (userId) try { localStorage.setItem(notificationStorageKey(userId), JSON.stringify(next)) } catch { /* Reading still works for this visit. */ }
  }
  const unread = items.filter(item => !read.includes(item.key)).length
  return (
    <DropdownMenu open={open} onOpenChange={next => { setOpen(next); if (next) void load() }}>
      <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="relative" aria-label="Notifications"><Bell className="h-5 w-5" />{unread > 0 && <Badge variant="destructive" className="absolute -top-1 -right-1">{unread}</Badge>}</Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-h-[75vh] overflow-y-auto">
        <DropdownMenuLabel>Recent result notifications · {unread} unread</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {!userId ? <p className="p-3 text-sm">Sign in to view notifications.</p> : loading ? <p role="status" className="p-3 text-sm">Loading notifications...</p> : error ? <div className="p-3"><p role="alert">{error}</p><Button size="sm" onClick={() => void load()}>Retry</Button></div> : items.length === 0 ? <p className="p-3 text-sm">No exam results yet.</p> : items.map(item => <DropdownMenuItem key={item.key} asChild><Link href={item.href} onClick={() => { markRead([item.key]); setOpen(false) }} className="flex flex-col items-start gap-1"><span className={read.includes(item.key) ? "font-normal" : "font-semibold"}>{item.title}</span>{item.date && <span className="text-xs text-muted-foreground">{new Date(item.date).toLocaleDateString()}</span>}</Link></DropdownMenuItem>)}
        {unread > 0 && <DropdownMenuItem onSelect={() => markRead(items.map(item => item.key))}>Mark all as read</DropdownMenuItem>}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild><Link href="/results">View all results</Link></DropdownMenuItem>
        <p className="p-2 text-xs text-muted-foreground">Read status is saved on this device.</p>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
