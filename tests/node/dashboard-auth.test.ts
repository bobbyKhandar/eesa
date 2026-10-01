import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { describe, it } from "node:test"

import {
  averageScore,
  examStatusOf,
  filterExams,
  formatPercentage,
  isRetryableStatus,
  matchesSearch,
  readUserInfo,
  recentSubmissions,
  sortBySubmittedAtDesc,
  submissionKey,
  submissionPercentage,
  submissionStatus,
  toFiniteNumber,
  toStringArray,
  uniqueExamCount,
} from "../../packages/frontend/lib/dashboardMetrics.ts"

import {
  buildUserProfile,
  isUserRole,
  resolveProvisionedRole,
  splitUpsertFields,
  SELF_SERVICE_ROLE,
} from "../../packages/backend/src/services/userProvisioning.ts"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const read = (relative: string) => readFileSync(join(repoRoot, relative), "utf8")

describe("numeric coercion", () => {
  it("accepts real finite numbers", () => {
    assert.equal(toFiniteNumber(0), 0)
    assert.equal(toFiniteNumber(-3.5), -3.5)
  })

  it("coerces numeric strings", () => {
    assert.equal(toFiniteNumber("42"), 42)
  })

  it("treats null, undefined and empty strings as absent rather than zero", () => {
    // `marksAchieved: null` read as 0 made every ungraded submission count as a 0%.
    assert.equal(toFiniteNumber(null), null)
    assert.equal(toFiniteNumber(undefined), null)
    assert.equal(toFiniteNumber(""), null)
    assert.equal(toFiniteNumber("  "), null)
  })

  it("rejects non-finite values", () => {
    assert.equal(toFiniteNumber(NaN), null)
    assert.equal(toFiniteNumber(Infinity), null)
    assert.equal(toFiniteNumber("abc"), null)
  })
})

describe("submissionPercentage", () => {
  it("computes a percentage from an actual zero score", () => {
    // `s.marksAchieved && s.totalMarks` treated a real 0 as falsy and rendered "N/A".
    assert.equal(submissionPercentage({ marksAchieved: 0, totalMarks: 50 }), 0)
  })

  it("refuses to divide by a zero or negative total", () => {
    // 0/0 used to render NaN% and Infinity.
    assert.equal(submissionPercentage({ marksAchieved: 0, totalMarks: 0 }), null)
    assert.equal(submissionPercentage({ marksAchieved: 10, totalMarks: -5 }), null)
  })

  it("returns null for an ungraded submission", () => {
    assert.equal(submissionPercentage({ marksAchieved: null, totalMarks: 50 }), null)
  })
})

describe("averageScore", () => {
  it("ignores submissions that have no score", () => {
    assert.equal(
      averageScore([
        { marksAchieved: 8, totalMarks: 10 },
        { marksAchieved: null, totalMarks: 10 },
      ]),
      80,
    )
  })

  it("returns null when nothing has been graded", () => {
    // The old initial value was the string "loading..", which rendered as
    // "loading..%" and then as 0% once the list emptied.
    assert.equal(averageScore([]), null)
    assert.equal(averageScore([{ marksAchieved: null, totalMarks: 10 }]), null)
  })

  it("rounds to one decimal", () => {
    assert.equal(
      averageScore([
        { marksAchieved: 1, totalMarks: 3 },
        { marksAchieved: 2, totalMarks: 3 },
      ]),
      50,
    )
  })
})

describe("submissionStatus", () => {
  it("is Completed only when a numeric score exists", () => {
    // `s.evaluatedAt` is not a field on the submission document, so every card
    // used to read "Submitted".
    assert.equal(submissionStatus({ marksAchieved: 0, totalMarks: 10 }), "Completed")
    assert.equal(submissionStatus({ marksAchieved: 7, totalMarks: 10 }), "Completed")
    assert.equal(submissionStatus({ marksAchieved: null, totalMarks: 10 }), "Submitted")
  })
})

describe("formatPercentage", () => {
  it("renders a real zero", () => {
    assert.equal(formatPercentage({ marksAchieved: 0, totalMarks: 20 }), "0.00%")
  })

  it("renders N/A instead of NaN or Infinity", () => {
    assert.equal(formatPercentage({ marksAchieved: 0, totalMarks: 0 }), "N/A")
    assert.equal(formatPercentage({}), "N/A")
  })
})

describe("uniqueExamCount", () => {
  it("counts an exam present in both allocations and submissions once", () => {
    // Summing the two arrays counted every taken exam twice.
    assert.equal(
      uniqueExamCount(
        [{ examId: "e1" }, { examId: "e2" }],
        [{ examId: "e1", submissionId: "s1" }],
      ),
      2,
    )
  })

  it("counts both sides when they do not overlap", () => {
    assert.equal(
      uniqueExamCount([{ examId: "e1" }], [{ examId: "e9", submissionId: "s9" }]),
      2,
    )
  })

  it("handles empty inputs", () => {
    assert.equal(uniqueExamCount([], []), 0)
  })
})

describe("recency ordering", () => {
  it("sorts by submittedAt, not by array position", () => {
    // The endpoint returns submissions keyed by id, so the first six were not
    // the six most recent.
    const sorted = sortBySubmittedAtDesc([
      { submissionId: "a", submittedAt: "2024-01-01T00:00:00.000Z" },
      { submissionId: "c", submittedAt: "2025-06-01T00:00:00.000Z" },
      { submissionId: "b", submittedAt: "2024-09-01T00:00:00.000Z" },
    ])
    assert.deepEqual(sorted.map((s) => s.submissionId), ["c", "b", "a"])
  })

  it("accepts Date objects and tolerates garbage", () => {
    const sorted = sortBySubmittedAtDesc([
      { submissionId: "a", submittedAt: new Date("2024-01-01") },
      { submissionId: "b", submittedAt: "not-a-date" },
    ])
    assert.equal(sorted[0].submissionId, "a")
  })

  it("caps the recent list", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      submissionId: `s${i}`,
      submittedAt: new Date(2020, 0, i + 1).toISOString(),
    }))
    assert.equal(recentSubmissions(many, 6).length, 6)
    assert.equal(recentSubmissions(many, 6)[0].submissionId, "s9")
  })
})

describe("submissionKey", () => {
  it("prefers the submission id", () => {
    assert.equal(submissionKey({ submissionId: "s1" }, 0), "s1")
  })

  it("falls back to a stable composite instead of a bare index", () => {
    assert.equal(submissionKey({ examId: "e1" }, 3), "e1-3")
  })
})

describe("matchesSearch", () => {
  it("returns true for an empty query", () => {
    assert.equal(matchesSearch({ title: "Anything" }, "  "), true)
  })

  it("does not throw on a record without a title", () => {
    // `exam.title.toLowerCase()` threw on any record missing a title.
    assert.doesNotThrow(() => matchesSearch({ description: "hi" }, "hi"))
    assert.equal(matchesSearch({}, "anything"), false)
    assert.equal(matchesSearch({ subject: "Physics" }, "phys"), true)
  })

  it("filters a list safely", () => {
    assert.equal(filterExams([{ title: "Maths" }, {}], "math").length, 1)
    assert.equal(filterExams([], "math").length, 0)
  })
})

describe("isRetryableStatus", () => {
  it("does not retry 4xx", () => {
    // 404 drives provisioning; retrying it three times with 1s + 2s backoff
    // delayed the real answer by ~3s.
    assert.equal(isRetryableStatus(404), false)
    assert.equal(isRetryableStatus(401), false)
    assert.equal(isRetryableStatus(400), false)
  })

  it("retries 5xx and 2xx passes through", () => {
    assert.equal(isRetryableStatus(500), true)
    assert.equal(isRetryableStatus(503), true)
    assert.equal(isRetryableStatus(200), true)
  })
})

describe("toStringArray", () => {
  it("keeps only string entries", () => {
    assert.deepEqual(toStringArray(["a", 1, null, "b"]), ["a", "b"])
    assert.deepEqual(toStringArray(undefined), [])
  })
})

describe("examStatusOf", () => {
  it("treats a future schedule as scheduled", () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    assert.equal(examStatusOf({ scheduledAt: future }), "scheduled")
  })

  it("treats a past schedule as active", () => {
    const past = new Date(Date.now() - 60_000).toISOString()
    assert.equal(examStatusOf({ scheduledAt: past }), "active")
  })

  it("treats a missing or invalid schedule as draft", () => {
    assert.equal(examStatusOf({}), "draft")
    assert.equal(examStatusOf({ scheduledAt: "nonsense" }), "draft")
  })
})

describe("readUserInfo", () => {
  it("accepts a well-formed payload", () => {
    const data = readUserInfo({
      success: true,
      data: { id: "u1", email: "a@b.c", role: "student", currentAllocatedExams: [], submissionHistory: [] },
    })
    assert.equal(data?.data?.id, "u1")
  })

  it("rejects the 200-with-null-data shape the route used to return", () => {
    assert.equal(readUserInfo({ data: null, success: true }), null)
    assert.equal(readUserInfo({ success: false, error: "User not provisioned" }), null)
    assert.equal(readUserInfo(null), null)
    assert.equal(readUserInfo("nope"), null)
  })
})

describe("user provisioning", () => {
  it("never grants teacher or admin from a client request", () => {
    assert.equal(SELF_SERVICE_ROLE, "student")
    assert.equal(resolveProvisionedRole(undefined, "admin"), "student")
    assert.equal(resolveProvisionedRole(undefined, "teacher"), "student")
    assert.equal(isUserRole("admin"), true)
    assert.equal(isUserRole("superuser"), false)
  })

  it("keeps an existing role so a promotion is not reset on every load", () => {
    assert.equal(resolveProvisionedRole("teacher", undefined), "teacher")
    assert.equal(resolveProvisionedRole("admin", "student"), "admin")
  })

  it("builds an insert document with no client-chosen role", () => {
    const profile = buildUserProfile(
      { userId: "u1", email: "a@b.c", name: "A B", imageUrl: "http://img" },
      { now: new Date("2025-01-01") },
    )
    assert.equal(profile._id, "u1")
    assert.equal(profile.email, "a@b.c")
    assert.equal(profile.name, "A B")
    assert.equal(profile.role, "student")
    assert.deepEqual(profile.currentAllocatedExams, [])
    assert.deepEqual(profile.submissionHistory, [])
  })

  it("splits Clerk-owned fields from insert-only fields", () => {
    const { $set, $setOnInsert } = splitUpsertFields({
      _id: "u1",
      email: "a@b.c",
      name: "A B",
      lastLogin: new Date(),
      role: "student",
      currentAllocatedExams: ["e1"],
      submissionHistory: ["s1"],
      createdAt: new Date(),
    })
    // Clerk-owned fields are refreshed on every sign-in.
    assert.deepEqual(Object.keys($set).sort(), ["email", "lastLogin", "name"])
    // Role and the exam arrays must not be reset on a returning sign-in.
    assert.deepEqual(Object.keys($setOnInsert).sort(), [
      "createdAt",
      "currentAllocatedExams",
      "role",
      "submissionHistory",
    ])
    // `_id` is immutable and is pinned by the upsert filter instead.
    assert.ok(!("$set" as Record<string, unknown>)._id)
    assert.ok(!($setOnInsert as Record<string, unknown>)._id)
  })

  it("omits absent optional fields instead of writing undefined", () => {
    const { $set } = splitUpsertFields({ email: "a@b.c" })
    assert.deepEqual(Object.keys($set), ["email"])
  })
})

describe("middleware protects the dashboard and user API", () => {
  const source = read("packages/frontend/middleware.ts")

  it("passes a handler to clerkMiddleware", () => {
    // A handler-less `clerkMiddleware()` only attaches the auth context and
    // protects nothing.
    assert.doesNotMatch(source, /clerkMiddleware\(\)/)
    assert.match(source, /clerkMiddleware\(async/)
  })

  it("matches the dashboard and /api/users paths", () => {
    assert.match(source, /createRouteMatcher/)
    assert.match(source, /'\/dashboard\(\.\*\)'/)
    assert.match(source, /'\/api\/users\(\.\*\)'/)
  })

  it("calls auth() and guards on userId", () => {
    assert.match(source, /await auth\(\)/)
    assert.match(source, /if \(userId\) return/)
  })

  it("answers API requests with 401 and page requests with a redirect", () => {
    assert.match(source, /pathname\.startsWith\('\/api\/'\)/)
    assert.match(source, /status: 401/)
    assert.match(source, /NextResponse\.redirect/)
    assert.match(source, /'\/sign-in'/)
  })
})

describe("dashboard layout and sign-in routes exist", () => {
  it("re-checks the session server-side", () => {
    const layout = read("packages/frontend/app/dashboard/layout.tsx")
    assert.match(layout, /await auth\(\)/)
    assert.match(layout, /redirect\('\/sign-in/)
  })

  it("provides the redirect target the guards point at", () => {
    const signIn = read("packages/frontend/app/sign-in/[[...sign-in]]/page.tsx")
    const signUp = read("packages/frontend/app/sign-up/[[...sign-up]]/page.tsx")
    assert.match(signIn, /<SignIn routing="path"/)
    assert.match(signUp, /<SignUp routing="path"/)
  })
})

describe("userInfo route", () => {
  const source = read("packages/frontend/app/api/users/userInfo/route.ts")

  it("derives identity from the session", () => {
    assert.match(source, /await auth\(\)/)
    assert.match(source, /userRepo\.getById\(userId\)/)
  })

  it("never looks the caller up by a body-supplied email unconditionally", () => {
    assert.doesNotMatch(source, /const resp = await userRepo\.getByEmail\(email\)/)
    assert.match(source, /record\.email !== email/)
    assert.match(source, /record\.role !== "admin"/)
    assert.match(source, /status: 403/)
  })

  it("404s an unprovisioned record so the dashboard can trigger creation", () => {
    assert.match(source, /status: 404/)
  })

  it("exposes a GET and redacts the raw document", () => {
    assert.match(source, /export async function GET/)
    assert.doesNotMatch(source, /\{data:resp/)
  })
})

describe("upsertByClerkId splits the update", () => {
  const source = read("packages/backend/src/database/repositories/UserRepository.ts")

  it("no longer sends everything through $setOnInsert", () => {
    // $setOnInsert for all fields meant a returning user's email/name went stale
    // after a Clerk change and lastLogin stayed frozen at first sign-in.
    assert.doesNotMatch(source, /\$setOnInsert: validation\.data/)
    assert.match(source, /splitUpsertFields\(/)
    assert.match(source, /const fields = splitUpsertFields/)
    assert.match(source, /^\s*fields,$/m)
  })
})

describe("exam creation uses the shared provisioning path", () => {
  const source = read("packages/frontend/app/api/exams/create/route.ts")

  it("no longer find-then-creates with a hardcoded teacher role", () => {
    assert.doesNotMatch(source, /getUserModel/)
    assert.doesNotMatch(source, /role: 'teacher'/)
    assert.doesNotMatch(source, /UserModel\.findById/)
  })

  it("goes through the atomic upsert", () => {
    assert.match(source, /buildUserProfile/)
    assert.match(source, /userRepo\.upsertByClerkId/)
  })
})

describe("dashboard page", () => {
  const source = read("packages/frontend/app/dashboard/page.tsx")

  it("uses absolute API paths", () => {
    // `"api/users/..."` resolved against the current route segment.
    assert.doesNotMatch(source, /fetch\(`api\//)
    assert.match(source, /"\/api\/users\/userInfo"/)
  })

  it("reads before it provisions", () => {
    const infoIndex = source.indexOf('"/api/users/userInfo"')
    const createIndex = source.indexOf('"/api/users/create"')
    assert.ok(infoIndex > -1 && createIndex > infoIndex)
    assert.match(source, /infoResponse\.status === 404/)
  })

  it("clears state on sign-out and aborts on cleanup", () => {
    assert.match(source, /if \(!user\?\.id\) \{/)
    assert.match(source, /setSubmissions\(\[\]\)/)
    assert.match(source, /new AbortController\(\)/)
    assert.match(source, /controller\.abort\(\)/)
    assert.match(source, /if \(!isLoaded\) return/)
  })

  it("does not let the client pick a role", () => {
    assert.doesNotMatch(source, /role:\s*"student"/)
    assert.doesNotMatch(source, /JSON\.stringify\(\{ user: user/)
  })

  it("does not log the Clerk user object", () => {
    assert.doesNotMatch(source, /console\.log\('User effect triggered'/)
    assert.doesNotMatch(source, /console\.log\('Create user response'/)
  })

  it("seeds the average as a number or null, never a string", () => {
    assert.doesNotMatch(source, /"loading\.\."/)
  })

  it("shares the retry policy with the tested helper", () => {
    assert.match(source, /isRetryableStatus\(response\.status\)/)
  })
})

describe("dashboard exams list", () => {
  const source = read("packages/frontend/app/dashboard/exams/page.tsx")

  it("does not hang on Loading exams... when signed out", () => {
    assert.match(source, /if \(!isLoaded\) return/)
    assert.match(source, /if \(!user\?\.id\) \{/)
  })

  it("does not index into a possibly missing title", () => {
    assert.doesNotMatch(source, /exam\.title\.toLowerCase\(\)\s*\|\|/)
    assert.doesNotMatch(source, /exams\.filter\(exam =>/)
    assert.match(source, /filterExams\(/)
  })

  it("has no link to a route that does not exist", () => {
    assert.doesNotMatch(source, /\/dashboard\/exams\/\$\{exam\.id\}\/edit/)
  })
})

describe("dashboard exam detail", () => {
  const source = read("packages/frontend/app/dashboard/exams/[id]/page.tsx")

  it("reads the route param through useParams, not a sync props object", () => {
    // `params.id` on a Next 15 promise was always undefined.
    assert.doesNotMatch(source, /params: \{ params: \{ id: string \} \}/)
    assert.match(source, /useParams<\{ id: string \}>\(\)/)
  })

  it("loads the real exam", () => {
    assert.match(source, /`\/api\/exams\/\$\{encodeURIComponent\(examId\)\}`/)
    assert.doesNotMatch(source, /Introduction to AI/)
    assert.doesNotMatch(source, /Score Distribution Chart/)
    assert.doesNotMatch(source, /submissions: 24/)
  })

  it("has no dead links or unhandled controls", () => {
    assert.doesNotMatch(source, /\/dashboard\/exams\/\$\{exam\.id\}\/results/)
    assert.doesNotMatch(source, />Edit Exam</)
    assert.match(source, /onClick=\{handleDelete\}/)
  })
})

describe("landing page CTA", () => {
  const source = read("packages/frontend/app/page.tsx")

  it("does not nest a Clerk button inside a Link", () => {
    assert.doesNotMatch(source, /<Link href="\/dashboard">\s*<SignInButton/)
  })

  it("gives Clerk a redirect target for both sign-in and sign-up", () => {
    assert.match(source, /<SignedOut>/)
    assert.match(source, /<SignedIn>/)
    assert.match(source, /SignInButton mode="modal" forceRedirectUrl="\/dashboard"/)
    assert.match(source, /SignUpButton mode="modal" forceRedirectUrl="\/dashboard"/)
  })

  it("has no unused Clerk imports", () => {
    assert.doesNotMatch(source, /UserButton/)
  })
})

describe("dead dashboard layout removed", () => {
  it("no longer ships the unreferenced file", () => {
    let exists = true
    try {
      read("packages/frontend/app/dashboard/rr.tsx")
    } catch {
      exists = false
    }
    assert.equal(exists, false)
  })

  it("renders a loading state instead of null", () => {
    const loading = read("packages/frontend/app/dashboard/exams/loading.tsx")
    assert.doesNotMatch(loading, /return null/)
  })
})
