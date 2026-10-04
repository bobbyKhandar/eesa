export async function requestStudyAnswer(query: string, request: typeof fetch = fetch): Promise<string> {
  const response = await request("/api/llm", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ inputMessage: query.trim() }),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok || data?.success !== true) throw new Error(data?.error || "The study assistant is unavailable. Please try again.")
  if (typeof data.result !== "string" || !data.result.trim()) throw new Error("The assistant returned an empty response. Please try again.")
  return data.result
}
