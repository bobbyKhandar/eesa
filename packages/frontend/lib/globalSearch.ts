export interface SearchResult { key: string; title: string; category: string; href: string }

export function buildSearchResults(query: string, exams: unknown, subjects: unknown, resources: unknown): SearchResult[] {
  const term = query.trim().toLowerCase()
  if (!term) return []
  const results: SearchResult[] = []
  const matches = (...values: unknown[]) => values.some(value => typeof value === "string" && value.toLowerCase().includes(term))
  if (Array.isArray(exams)) for (const exam of exams) {
    if (exam && typeof exam.id === "string" && typeof exam.title === "string" && matches(exam.title, exam.subject, exam.description)) {
      results.push({ key: `exam:${exam.id}`, title: exam.title, category: "Exam", href: `/dashboard/exams/${encodeURIComponent(exam.id)}` })
    }
  }
  if (Array.isArray(subjects)) for (const subject of subjects) {
    if (subject && typeof subject.subjectName === "string" && matches(subject.subjectName, subject.subjectCode)) {
      results.push({ key: `subject:${subject.subjectName}`, title: subject.subjectName, category: "Subject", href: `/subjects/${encodeURIComponent(subject.subjectName)}` })
    }
  }
  if (Array.isArray(resources)) for (const resource of resources) {
    if (resource && typeof resource.name === "string" && matches(resource.name, resource.code)) {
      results.push({ key: `resource:${resource.name}`, title: `${resource.name} question bank`, category: "Resource", href: `/resources?subject=${encodeURIComponent(resource.name)}` })
    }
  }
  return results.filter((result, index) => results.findIndex(item => item.key === result.key) === index)
}

export async function searchCatalog(query: string, signal: AbortSignal, request: typeof fetch = fetch) {
  const sources = [
    { name: "exams", url: "/api/exams/list", extract: (data: any) => data.exams },
    { name: "subjects", url: "/api/subjects", extract: (data: any) => data.subjects },
    { name: "resources", url: "/api/resources?action=subjects", extract: (data: any) => data.data?.subjects },
  ]
  const responses = await Promise.all(sources.map(async source => {
    try {
      const response = await request(source.url, { signal, cache: "no-store" })
      const data = await response.json()
      if (!response.ok || data.success === false) throw new Error("Search source unavailable")
      const rows = source.extract(data)
      if (!Array.isArray(rows)) throw new Error("Invalid search response")
      return { rows, error: null }
    } catch (error) {
      if (signal.aborted) throw error
      return { rows: [], error: `Could not search ${source.name}. Please try again.` }
    }
  }))
  return { results: buildSearchResults(query, ...responses.map(response => response.rows) as [unknown, unknown, unknown]), errors: responses.flatMap(response => response.error ? [response.error] : []) }
}
