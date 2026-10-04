import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire, Module } from "node:module"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { JSDOM } from "jsdom"
import ts from "typescript"

test("navigation and search interactions, plus account-settings authentication states", async () => {
  const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", { url: "http://localhost/dashboard", pretendToBeVisual: true })
  for (const key of ["window", "document", "localStorage", "HTMLElement", "Element", "Node", "NodeFilter", "MutationObserver", "CustomEvent", "Event", "KeyboardEvent", "HTMLInputElement"]) {
    Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] })
  }
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator })
  globalThis.getComputedStyle = dom.window.getComputedStyle
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
  globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const media = new dom.window.EventTarget()
  media.matches = false
  dom.window.matchMedia = () => media
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  dom.window.HTMLElement.prototype.scrollIntoView = () => {}

  const require = createRequire(import.meta.url)
  const React = require("react")
  const { createRoot } = require("react-dom/client")
  const base = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
  let pathname = "/dashboard"
  let account = { isLoaded: true, isSignedIn: true }
  const cache = new Map()
  // Load the real TSX components and Radix primitives; stub only Next/Clerk platform boundaries.
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports
    const input = readFileSync(filename, "utf8").replace(/<(\/?)(html|body)(?=[ >])/g, "<$1div")
    const mod = new Module(filename)
    cache.set(filename, mod)
    mod.filename = filename
    mod.paths = Module._nodeModulePaths(dirname(filename))
    mod.require = (id) => {
      if (id.endsWith(".css")) return {}
      if (id.startsWith(".")) return load(resolve(dirname(filename), id))
      if (id === "next/navigation") return { usePathname: () => pathname }
      if (id === "next/font/google") return { Inter: () => ({ className: "inter" }) }
      if (id === "next/link") return { __esModule: true, default: React.forwardRef((props, ref) => React.createElement("a", { ...props, ref, onClick: (event) => { props.onClick?.(event); event.preventDefault() } })) }
      if (id === "@clerk/nextjs") return { SignedIn: ({ children }) => children, SignedOut: () => null, SignInButton: ({ children }) => children, UserButton: () => null, useUser: () => account, UserProfile: ({ routing }) => React.createElement("div", { "data-account-settings": routing }, "Authenticated account settings") }
      if (id.startsWith("@/")) {
        const path = resolve(base, "packages", id.slice(2))
        try { return load(path + ".tsx") } catch (error) { if (error.code !== "ENOENT") throw error; return load(path + ".ts") }
      }
      return require(id)
    }
    const source = ts.transpileModule(input, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText
    mod._compile(source, filename)
    return mod.exports
  }
  const Layout = load(resolve(base, "packages/frontend/app/clientLayout.tsx")).default
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  const act = React.act
  const render = async (isAdmin = false) => act(async () => { root.render(React.createElement(Layout, { isAdmin }, "Page")) })
  const click = async (element) => { assert.ok(element); await act(async () => { element.click(); await new Promise(resolve => setTimeout(resolve, 20)) }) }
  const trigger = () => document.querySelector('[aria-label="Open navigation"]')
  const dialog = () => document.querySelector('[role="dialog"]')
  try {
    await render()
    assert.equal(dialog(), null)
    await click(trigger())
    assert.ok(dialog())
    assert.equal(trigger().getAttribute("aria-expanded"), "true")
    assert.ok(dialog().querySelector('a[href="/dashboard/exams"]'))
    assert.equal(dialog().querySelector('a[href="/admin"]'), null)
    assert.ok(dialog().contains(document.activeElement), "focus enters the navigation dialog")
    await click(dialog().querySelector('a[href="/dashboard/exams"]'))
    assert.equal(dialog(), null)
    await click(trigger())
    await act(async () => { document.activeElement.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })) })
    assert.equal(dialog(), null)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
    assert.ok(document.activeElement === trigger(), "Escape restores focus to the menu button")
    await click(trigger())
    pathname = "/resources"
    await render()
    assert.equal(dialog(), null)
    await render(true)
    await click(trigger())
    assert.ok(dialog().querySelector('a[href="/admin"]'))
    await act(async () => { media.matches = true; media.dispatchEvent(new dom.window.Event("change")) })
    assert.equal(dialog(), null)
    assert.equal(trigger().getAttribute("aria-expanded"), "false")
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (url) => new Response(JSON.stringify(String(url).includes("exams")
      ? { success: true, exams: [{ id: "math-exam", title: "Mathematics Exam" }] }
      : String(url).includes("resources") ? { success: true, data: { subjects: [{ name: "Mathematics" }] } }
      : { subjects: [{ subjectName: "Mathematics" }] }))
    try {
      await click(document.querySelector('[aria-label="Open search"]'))
      const input = dialog().querySelector("input")
      await act(async () => {
        Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(input, "math")
        input.dispatchEvent(new dom.window.Event("input", { bubbles: true }))
      })
      await act(async () => { dialog().querySelector("form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })) })
      assert.equal(dialog().querySelectorAll("li a").length, 3, "mobile search displays live results from all three catalogues")
      assert.equal(dialog().querySelector("li a").getAttribute("href"), "/dashboard/exams/math-exam")
      await click(dialog().querySelector("li a"))
      assert.equal(dialog(), null, "selecting a search result closes the search dialog")
    } finally { globalThis.fetch = originalFetch }
    const Notifications = load(resolve(base, "packages/frontend/components/result-notifications.tsx")).ResultNotifications
    account = { isLoaded: true, isSignedIn: true, user: { id: "notifications-user" } }
    globalThis.fetch = async () => new Response(JSON.stringify({ success: true, data: { results: [{ id: "my-result", examName: "Real result", date: "2026-10-01", score: 10, totalMarks: 20 }] } }))
    try {
      await act(async () => root.render(React.createElement(Notifications)))
      const bell = container.querySelector('[aria-label="Notifications"]')
      assert.match(bell.textContent, /1/)
      await act(async () => bell.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })))
      assert.match(document.body.textContent, /Exam result: Real result/)
      const resultLink = document.querySelector('a[href="/results/my-result"]')
      await click(resultLink)
      assert.doesNotMatch(container.querySelector('[aria-label="Notifications"]').textContent, /1/)
      assert.match(localStorage.getItem("eesa:read-results:notifications-user"), /my-result:10:20/)
      assert.equal(document.querySelector('[role="menu"]'), null)
    } finally { globalThis.fetch = originalFetch }
    const SettingsPage = load(resolve(base, "packages/frontend/app/dashboard/settings/page.tsx")).default
    account = { isLoaded: false, isSignedIn: false }
    await act(async () => root.render(React.createElement(SettingsPage)))
    assert.match(container.textContent, /Loading account settings/)
    assert.equal(container.querySelector("[data-account-settings]"), null)
    account = { isLoaded: true, isSignedIn: false }
    await act(async () => root.render(React.createElement(SettingsPage)))
    assert.match(container.textContent, /Sign in to manage your account/)
    assert.equal(container.querySelector("[data-account-settings]"), null)
    account = { isLoaded: true, isSignedIn: true }
    await act(async () => root.render(React.createElement(SettingsPage)))
    assert.equal(container.querySelector("[data-account-settings]").getAttribute("data-account-settings"), "hash")
    assert.doesNotMatch(container.textContent, /John Doe|Active Sessions|Two-Factor Authentication.*Enabled/)
    const AssistantPage = load(resolve(base, "packages/frontend/app/ai-helper/page.tsx")).default
    let answerFails = false
    globalThis.fetch = async (url) => String(url) === "/api/results"
      ? new Response(JSON.stringify({ success: true, data: { results: [{ id: "real-result", examName: "My Real Exam", subject: "Math", score: 0, totalMarks: 20, percentage: 0 }] } }))
      : answerFails ? new Response(JSON.stringify({ error: "Provider unavailable" }), { status: 503 })
      : new Response(JSON.stringify({ success: true, result: "This is the actual model answer." }))
    try {
      await act(async () => root.render(React.createElement(AssistantPage)))
      assert.match(container.textContent, /My Real Exam/)
      assert.doesNotMatch(container.textContent, /Data Structures Final|AI Online|45\.5/)
      const question = container.querySelector('[aria-label="Study question"]')
      const ask = async (text) => act(async () => {
        Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(question, text)
        question.dispatchEvent(new dom.window.Event("input", { bubbles: true }))
      })
      await ask("Explain trees")
      await act(async () => container.querySelector("form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })))
      assert.match(container.textContent, /This is the actual model answer/)
      answerFails = true
      await ask("Retry this question")
      await act(async () => container.querySelector("form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })))
      assert.match(container.querySelector('[role="alert"]').textContent, /Provider unavailable/)
      assert.equal(question.value, "Retry this question")
      assert.equal(container.querySelector('button[type="submit"]').disabled, false, "failed AI requests restore the send control")
    } finally { globalThis.fetch = originalFetch }
    const AnalyticsPage = load(resolve(base, "packages/frontend/app/dashboard/analytics/page.tsx")).default
    globalThis.fetch = async () => new Response(JSON.stringify({ success: true, data: { results: [
      { id: "math", examName: "Real Math Exam", subject: "Math", date: "2026-10-01", score: 0, totalMarks: 20, percentage: 0, status: "failed" },
      { id: "cs", examName: "Real CS Exam", subject: "CS", date: "2026-10-01", score: 18, totalMarks: 20, percentage: 90, status: "passed" },
    ] } }))
    const originalCreate = URL.createObjectURL
    const originalRevoke = URL.revokeObjectURL
    const downloads = []
    const blobs = []
    URL.createObjectURL = blob => { blobs.push(blob); return "blob:analytics-test" }
    URL.revokeObjectURL = () => {}
    const capture = event => { if (event.target.download) { downloads.push(event.target.download); event.preventDefault() } }
    document.addEventListener("click", capture)
    try {
      await act(async () => root.render(React.createElement(AnalyticsPage)))
      assert.match(container.textContent, /Real Math Exam/)
      const subjectFilter = container.querySelector('[aria-label="Subject filter"]')
      await act(async () => { subjectFilter.value = "CS"; subjectFilter.dispatchEvent(new dom.window.Event("change", { bubbles: true })) })
      assert.doesNotMatch(container.textContent, /Real Math Exam/)
      assert.match(container.textContent, /Real CS Exam/)
      await click(Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Export Data"))
      await click(Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Generate Report"))
      assert.deepEqual(downloads, ["exam-performance.csv", "performance-report.txt"])
      assert.match(await blobs[0].text(), /Real CS Exam/)
      assert.doesNotMatch(await blobs[0].text(), /Real Math Exam/)
      assert.match(await blobs[1].text(), /Average score: 90%/)
    } finally {
      globalThis.fetch = originalFetch
      URL.createObjectURL = originalCreate
      URL.revokeObjectURL = originalRevoke
      document.removeEventListener("click", capture)
    }
  } finally {
    await act(async () => root.unmount())
    dom.window.close()
  }
})
