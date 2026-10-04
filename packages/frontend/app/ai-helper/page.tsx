"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import Link from "next/link"
import { useUser } from "@clerk/nextjs"
import { Button } from "@/frontend/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/frontend/components/ui/card"
import { Input } from "@/frontend/components/ui/input"
import { requestStudyAnswer } from "@/frontend/lib/studyAssistant"
import type { ResultRow } from "@/frontend/lib/examResults"

interface Message { id: number; type: "user" | "ai"; content: string }

export default function AIHelperPage() {
  const { isLoaded, isSignedIn } = useUser()
  const [messages, setMessages] = useState<Message[]>([{ id: 0, type: "ai", content: "Hello! Ask me a study question or discuss one of your exam results." }])
  const [inputMessage, setInputMessage] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<ResultRow[]>([])
  const [resultsLoading, setResultsLoading] = useState(true)
  const [resultsError, setResultsError] = useState<string | null>(null)
  const messagesEnd = useRef<HTMLDivElement>(null)
  const sending = useRef(false)

  useEffect(() => {
    if (!isLoaded) return
    if (!isSignedIn) { setResults([]); setResultsLoading(false); return }
    const controller = new AbortController()
    setResultsLoading(true)
    setResultsError(null)
    fetch("/api/results", { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        const data = await response.json()
        if (!response.ok || !data.success || !Array.isArray(data.data?.results)) throw new Error("Could not load your exam results.")
        if (!controller.signal.aborted) setResults(data.data.results)
      })
      .catch(() => { if (!controller.signal.aborted) setResultsError("Could not load your exam results. Visit Results to retry.") })
      .finally(() => { if (!controller.signal.aborted) setResultsLoading(false) })
    return () => controller.abort()
  }, [isLoaded, isSignedIn])

  useEffect(() => { messagesEnd.current?.scrollIntoView({ behavior: "smooth" }) }, [messages, isLoading])

  async function send(event: FormEvent) {
    event.preventDefault()
    const query = inputMessage.trim()
    if (!query || sending.current || !isSignedIn) return
    sending.current = true
    setMessages(previous => [...previous, { id: Date.now(), type: "user", content: query }])
    setInputMessage("")
    setError(null)
    setIsLoading(true)
    try {
      const content = await requestStudyAnswer(query)
      setMessages(previous => [...previous, { id: Date.now() + 1, type: "ai", content }])
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Request failed. Please try again.")
      setInputMessage(query)
    } finally {
      sending.current = false
      setIsLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div><h1 className="text-3xl font-bold">AI Study Assistant</h1><p className="text-muted-foreground">Ask study questions and discuss your exam performance.</p></div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Study conversation</CardTitle><CardDescription>Answers are requested when you send a message. Conversations last for this visit.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="max-h-[60vh] overflow-y-auto space-y-3" role="log" aria-label="Study conversation" aria-live="polite">
              {messages.map(message => <div key={message.id} className={`rounded-lg p-3 ${message.type === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}><p className="text-xs font-medium mb-1">{message.type === "user" ? "You" : "Assistant"}</p><p className="whitespace-pre-wrap">{message.content}</p></div>)}
              {isLoading && <p role="status">Generating an answer...</p>}
              <div ref={messagesEnd} />
            </div>
            {error && <p role="alert" className="text-red-600">{error}</p>}
            {isLoaded && !isSignedIn && <p>Sign in to use the study assistant.</p>}
            <form onSubmit={send} className="flex gap-2">
              <Input aria-label="Study question" placeholder="Ask a study question..." value={inputMessage} onChange={event => setInputMessage(event.target.value)} disabled={!isSignedIn || isLoading} />
              <Button type="submit" disabled={!isSignedIn || isLoading || !inputMessage.trim()}>Send</Button>
            </form>
            <div className="flex flex-wrap gap-2">{["Create a study plan for me", "Give me study tips"].map(prompt => <Button key={prompt} variant="outline" disabled={isLoading || !isSignedIn} onClick={() => setInputMessage(prompt)}>{prompt}</Button>)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Your recent results</CardTitle><CardDescription>Results from your signed-in account.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            {resultsLoading ? <p role="status">Loading results...</p> : resultsError ? <p role="alert">{resultsError}</p> : results.length === 0 ? <p>No exam results yet.</p> : results.slice(0, 5).map(result => <div key={result.id} className="rounded border p-3 space-y-2"><Link className="font-medium underline" href={`/results/${encodeURIComponent(result.id)}`}>{result.examName}</Link><p>{result.subject} · {result.score}/{result.totalMarks} ({result.percentage.toFixed(1)}%)</p><Button variant="outline" size="sm" disabled={isLoading || !isSignedIn} onClick={() => setInputMessage(`Help me improve in ${result.examName} (${result.subject}). I scored ${result.score} out of ${result.totalMarks}.`)}>Discuss this result</Button></div>)}
            <Link href="/results" className="block underline">View all results</Link>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
