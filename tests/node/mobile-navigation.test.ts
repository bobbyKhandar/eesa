import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire, Module } from "node:module"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { JSDOM } from "jsdom"
import ts from "typescript"

test("mobile navigation opens, preserves role access, and closes on navigation, Escape and desktop resize", async () => {
  const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", { url: "http://localhost/dashboard", pretendToBeVisual: true })
  for (const key of ["window", "document", "HTMLElement", "Element", "Node", "NodeFilter", "MutationObserver", "CustomEvent", "Event", "KeyboardEvent", "HTMLInputElement"]) {
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

  const require = createRequire(import.meta.url)
  const React = require("react")
  const { createRoot } = require("react-dom/client")
  const base = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
  let pathname = "/dashboard"
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
      if (id === "next/navigation") return { usePathname: () => pathname }
      if (id === "next/font/google") return { Inter: () => ({ className: "inter" }) }
      if (id === "next/link") return { __esModule: true, default: React.forwardRef((props, ref) => React.createElement("a", { ...props, ref, onClick: (event) => { event.preventDefault(); props.onClick?.(event) } })) }
      if (id === "@clerk/nextjs") return { SignedIn: ({ children }) => children, SignedOut: () => null, SignInButton: ({ children }) => children, UserButton: () => null }
      if (id.startsWith("@/")) {
        const path = resolve(base, "packages", id.slice(2))
        try { return load(path + ".tsx") } catch (error) { if (error.code !== "ENOENT") throw error; return load(path + ".ts") }
      }
      return require(id)
    }
    const source = ts.transpileModule(input, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText
    mod._compile(source, filename)
    return mod.exports
  }
  const Layout = load(resolve(base, "packages/frontend/app/clientLayout.tsx")).default
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  const act = React.act
  const render = async (isAdmin = false) => act(async () => { root.render(React.createElement(Layout, { isAdmin }, "Page")) })
  const click = async (element) => { assert.ok(element); await act(async () => { element.click() }) }
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
    assert.equal(document.activeElement, trigger(), "Escape restores focus to the menu button")
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
  } finally {
    await act(async () => root.unmount())
    dom.window.close()
  }
})
