import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";

import {
  USER_DOCUMENT_FIELDS,
  USER_ROLES,
  USER_STATUSES,
  countUsersByStatus,
  isUserRole,
  isUserStatus,
} from "../../packages/backend/src/database/schemas/userDocumentSpec.ts";

import {
  ADMIN_ROLE,
  filterNavigation,
  isAdminPath,
  isAdminRole,
  type NavigationSection,
} from "../../packages/frontend/lib/adminAccess.ts";

import {
  buildPyqStats,
  buildSubjectCatalog,
  naturalCompare,
  questionTitle,
  reconcileSelection,
  selectBranch,
  selectSemester,
  sortLabels,
} from "../../packages/frontend/lib/resourceCatalog.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (relative: string) => readFileSync(join(repoRoot, relative), "utf8");

describe("user status bookkeeping", () => {
  it("counts a stored status", () => {
    assert.deepEqual(
      countUsersByStatus([{ status: "active" }, { status: "inactive" }, { status: "suspended" }]),
      { active: 1, inactive: 1, suspended: 1 }
    );
  });

  it("treats a record with no status as active", () => {
    // userZodSchema dropped `status` from every write, so no document had one and
    // `getCounts()` reported 0 active / 0 inactive / 0 suspended.
    assert.deepEqual(countUsersByStatus([{}, {}]), { active: 2, inactive: 0, suspended: 0 });
  });

  it("treats an unrecognised status as active rather than losing the user", () => {
    assert.deepEqual(countUsersByStatus([{ status: "ACTIVE " }, { status: null }]), {
      active: 2,
      inactive: 0,
      suspended: 0,
    });
  });

  it("recognises only the declared roles and statuses", () => {
    assert.equal(isUserRole("admin"), true);
    assert.equal(isUserRole("Admin"), false);
    assert.equal(isUserRole("faculty"), false);
    assert.equal(isUserRole(null), false);
    assert.equal(isUserStatus("suspended"), true);
    assert.equal(isUserStatus("banned"), false);
    assert.deepEqual([...USER_ROLES], ["student", "teacher", "admin"]);
    assert.deepEqual([...USER_STATUSES], ["active", "inactive", "suspended"]);
  });
});

describe("user schema keeps every persisted field", () => {
  const source = read("packages/backend/src/database/schemas/userSchemaZod.ts");

  it("declares each field of the inventory", () => {
    // Zod strips undeclared keys, so a field missing here is a silently
    // discarded write rather than a type error.
    for (const field of USER_DOCUMENT_FIELDS) {
      assert.match(source, new RegExp(`^\\s*${field}:`, "m"), `userZodSchema is missing ${field}`);
    }
  });

  it("declares nothing outside the inventory", () => {
    const userObject = source.slice(
      source.indexOf("export const userZodSchema"),
      source.indexOf("export type User =")
    );
    const declared = [...userObject.matchAll(/^ {2}(\w+):/gm)].map((match) => match[1]);
    assert.deepEqual(declared.sort(), [...USER_DOCUMENT_FIELDS].sort());
  });

  it("persists status, branch and settings with defaults", () => {
    assert.match(source, /status: z\.enum\(USER_STATUSES\)/);
    assert.match(source, /branch: z\.string\(\)/);
    assert.match(source, /settings: userSettingsZodSchema/);
    // Nested defaults matter: `update()` runs userZodSchema.partial(), so a
    // partial settings payload must fill in the flags it does not mention.
    assert.match(source, /notifications: userNotificationSettingsZodSchema\.default\(\{\}\)/);
    assert.match(source, /preferences: userPreferencesZodSchema\.default\(\{\}\)/);
    assert.match(source, /privacy: userPrivacySettingsZodSchema\.default\(\{\}\)/);
  });
});

describe("getCounts matches legacy documents", () => {
  const source = read("packages/backend/src/database/repositories/UserRepository.ts");

  it("counts status-less records as active", () => {
    assert.match(source, /\{ status: 'active' \}, \{ status: \{ \$exists: false \} \}/);
  });
});

describe("admin role predicate", () => {
  it("accepts only the admin role", () => {
    assert.equal(isAdminRole("admin"), true);
    assert.equal(isAdminRole(" Admin "), true);
    assert.equal(ADMIN_ROLE, "admin");
  });

  it("rejects every non-admin role and every non-string", () => {
    for (const value of ["student", "teacher", "administrator", "admin,student", "", null, undefined, 1, {}]) {
      assert.equal(isAdminRole(value), false, `${String(value)} must not pass the admin guard`);
    }
  });
});

describe("admin navigation gating", () => {
  const sections: NavigationSection[] = [
    { title: "Main", items: [{ name: "Dashboard", href: "/dashboard" }] },
    {
      title: "Admin",
      items: [
        { name: "Admin Panel", href: "/admin", adminOnly: true },
        { name: "Database", href: "/admin/database", adminOnly: true },
      ],
    },
  ];

  it("hides admin-only items and the emptied section from non-admins", () => {
    const visible = filterNavigation(sections, false);
    assert.deepEqual(
      visible.map((section) => section.title),
      ["Main"]
    );
    assert.equal(
      visible.some((section) => section.items.some((item) => item.adminOnly)),
      false
    );
  });

  it("shows everything to an admin", () => {
    const visible = filterNavigation(sections, true);
    assert.deepEqual(
      visible.map((section) => section.title),
      ["Main", "Admin"]
    );
    assert.equal(visible[1].items.length, 2);
  });

  it("does not mutate the source navigation", () => {
    filterNavigation(sections, false);
    assert.equal(sections[1].items.length, 2);
  });

  it("recognises the /admin segment only", () => {
    assert.equal(isAdminPath("/admin"), true);
    assert.equal(isAdminPath("/admin/users"), true);
    assert.equal(isAdminPath("/admin/database/backup"), true);
    assert.equal(isAdminPath("/administrator"), false);
    assert.equal(isAdminPath("/dashboard/admin"), false);
    assert.equal(isAdminPath("/resources"), false);
  });
});

describe("admin segment guard", () => {
  it("exists and gates on the stored role", () => {
    const layout = read("packages/frontend/app/admin/layout.tsx");
    assert.match(layout, /await auth\(\)/);
    assert.match(layout, /resolveIsAdmin\(\)/);
    assert.match(layout, /redirect\("\/sign-in/);
    assert.match(layout, /redirect\("\/dashboard"\)/);
  });

  it("fails closed when the session or the lookup fails", () => {
    const resolver = read("packages/frontend/lib/resolveAdmin.ts");
    assert.match(resolver, /if \(!userId\) \{\s*return false/);
    assert.match(resolver, /catch \(error\)[\s\S]*return false/);
  });

  it("hides the admin nav section for everyone else", () => {
    const sidebar = read("packages/frontend/components/permanent-sidebar.tsx");
    const adminLinks = [...sidebar.matchAll(/href: "(\/admin[^"]*)"/g)];
    assert.equal(adminLinks.length, 5);
    // Every admin link must be flagged, not just the section header.
    assert.equal((sidebar.match(/adminOnly: true/g) ?? []).length, adminLinks.length);
    assert.match(sidebar, /filterNavigation\(navigationItems, isAdmin\)/);
  });
});

describe("semester and branch labels sort naturally", () => {
  it("orders single digits before double digits", () => {
    // `["Semester 10", "Semester 2"].sort()` put Semester 10 first.
    assert.deepEqual(sortLabels(["Semester 10", "Semester 2", "Semester 1"]), [
      "Semester 1",
      "Semester 2",
      "Semester 10",
    ]);
    assert.deepEqual(sortLabels(["S10", "S9", "S1"]), ["S1", "S9", "S10"]);
  });

  it("de-duplicates and keeps non-numeric labels", () => {
    assert.deepEqual(sortLabels(["General", "S2", "S2", "General"]), ["General", "S2"]);
  });

  it("is a stable ordering", () => {
    assert.ok(naturalCompare("S1", "S1") === 0);
    assert.ok(naturalCompare("S2", "S1") > 0);
    assert.ok(naturalCompare("S10", "S9") > 0);
    assert.ok(naturalCompare("Semester 2", "Semester 10") < 0);
  });
});

describe("subject catalogue", () => {
  const rows = [
    { subjectName: "Physics", subjectCode: "PH01", branch: "Science", semester: "S1", reportCount: 2 },
    { subjectName: "Physics", subjectCode: "PH01", branch: "Science", semester: "S3", reportCount: 1 },
    { subjectName: "Mathematics", subjectCode: "MA01", branch: "Science", semester: "S1", reportCount: 3 },
  ];

  it("keeps the real semesters instead of collapsing them into one", () => {
    const catalog = buildSubjectCatalog(rows);
    assert.deepEqual(catalog.semesters, ["S1", "S3"]);
    assert.deepEqual(catalog.grouped.Science.S1, ["Mathematics", "Physics"]);
    assert.deepEqual(catalog.grouped.Science.S3, ["Physics"]);
  });

  it("lists a subject once with all of its semesters", () => {
    const catalog = buildSubjectCatalog(rows);
    const physics = catalog.subjects.filter((subject) => subject.name === "Physics");
    assert.equal(physics.length, 1);
    assert.deepEqual(physics[0].semesters, ["S1", "S3"]);
    assert.equal(physics[0].reportCount, 3);
    assert.equal(physics[0].code, "PH01");
    assert.equal(catalog.uniqueSubjectCount, 2);
  });

  it("reads the code from subjectCode and counts from the question index", () => {
    const catalog = buildSubjectCatalog(rows, { Physics: 7, Mathematics: 0 });
    assert.equal(catalog.subjects.find((subject) => subject.name === "Physics")?.questionCount, 7);
    assert.equal(catalog.subjects.find((subject) => subject.name === "Mathematics")?.questionCount, 0);
  });

  it("does not invent a semester label for records without one", () => {
    const catalog = buildSubjectCatalog([{ subjectName: "Chemistry", branch: "Science" }]);
    assert.deepEqual(catalog.semesters, ["General"]);
    assert.deepEqual(catalog.grouped.Science.General, ["Chemistry"]);
  });

  it("survives empty and malformed input", () => {
    assert.deepEqual(buildSubjectCatalog([]), {
      subjects: [],
      branches: [],
      semesters: [],
      grouped: {},
      uniqueSubjectCount: 0,
    });
    const messy = buildSubjectCatalog([
      { subjectName: "  ", branch: null },
      { subjectName: "Physics", semester: "  S1 ", reportCount: Number.NaN },
    ] as never);
    assert.deepEqual(messy.branches, ["General"]);
    assert.equal(messy.subjects[0].reportCount, 0);
  });
});

describe("subject selection follows the catalogue", () => {
  const catalog = buildSubjectCatalog([
    { subjectName: "Physics", branch: "Science", semester: "S1" },
    { subjectName: "Physics", branch: "Engineering", semester: "S1" },
  ]);

  it("clears the semester and subject when the branch changes", () => {
    const selection = { branch: "Science", semester: "S1", subject: "Physics" };
    const next = selectBranch(selection, "Engineering");
    assert.deepEqual(next, { branch: "Engineering", semester: "", subject: "" });
  });

  it("keeps the selection when the branch does not change", () => {
    const selection = { branch: "Science", semester: "S1", subject: "Physics" };
    assert.equal(selectBranch(selection, "Science"), selection);
  });

  it("clears the subject when the semester changes", () => {
    const selection = { branch: "Science", semester: "S1", subject: "Physics" };
    assert.deepEqual(selectSemester(selection, "S3"), { branch: "Science", semester: "S3", subject: "" });
    assert.equal(selectSemester(selection, "S1"), selection);
  });

  it("drops a selection the catalogue no longer offers", () => {
    // A branch change used to leave the previous branch's subject selected, and
    // the header then claimed it belonged to the new branch.
    const stale = { branch: "Science", semester: "S1", subject: "Chemistry" };
    assert.deepEqual(reconcileSelection(stale, catalog), { branch: "Science", semester: "S1", subject: "" });

    assert.deepEqual(reconcileSelection({ branch: "Arts", semester: "S1", subject: "" }, catalog), {
      branch: "",
      semester: "",
      subject: "",
    });
    assert.deepEqual(reconcileSelection({ branch: "Science", semester: "S9", subject: "" }, catalog), {
      branch: "Science",
      semester: "",
      subject: "",
    });
    assert.deepEqual(reconcileSelection({ branch: "Science", semester: "S1", subject: "Physics" }, catalog), {
      branch: "Science",
      semester: "S1",
      subject: "Physics",
    });
  });

  it("is a no-op before the catalogue arrives", () => {
    const selection = { branch: "Science", semester: "S1", subject: "Physics" };
    assert.equal(reconcileSelection(selection, null), selection);
  });
});

describe("PYQ row labels and stats", () => {
  it("never renders the text undefined", () => {
    // `q.text?.substring(0, 50) + "..." || fallback` is the truthy string
    // "undefined..." because `undefined + "..."` never short-circuits.
    assert.equal(questionTitle(undefined, "Question 3"), "Question 3");
    assert.equal(questionTitle(null, "Question 3"), "Question 3");
    assert.equal(questionTitle("   ", "Question 3"), "Question 3");
    assert.equal(questionTitle("What is a monad?", "Question 3"), "What is a monad?");
  });

  it("truncates long text with an ellipsis", () => {
    assert.equal(questionTitle("x".repeat(80), "Question 1"), `${"x".repeat(50)}...`);
    assert.equal(questionTitle(`${"y".repeat(50)} tail`, "Question 1"), `${"y".repeat(50)}...`);
  });

  it("reports every stat the resource page reads", () => {
    const stats = buildPyqStats({
      uniqueQuestions: 4,
      totalOccurrences: 9,
      avgOccurrence: 2.25,
      bloomsDistribution: { apply: 4 },
      subjectCount: 1,
    });
    assert.deepEqual(stats, {
      totalQuestions: 9,
      uniqueQuestions: 4,
      totalOccurrences: 9,
      avgOccurrence: 2.3,
      bloomsDistribution: { apply: 4 },
      subjectCount: 1,
    });
  });

  it("coerces missing or nonsensical stats to zero", () => {
    const stats = buildPyqStats({
      uniqueQuestions: Number.NaN,
      totalOccurrences: -4,
      avgOccurrence: Number.POSITIVE_INFINITY,
      bloomsDistribution: undefined as never,
      subjectCount: 0,
    });
    assert.equal(stats.totalQuestions, 0);
    assert.equal(stats.uniqueQuestions, 0);
    assert.equal(stats.avgOccurrence, 0);
    assert.deepEqual(stats.bloomsDistribution, {});
    assert.equal(stats.subjectCount, 0);
  });
});

describe("resources route reads the fields the summary returns", () => {
  const source = read("packages/frontend/app/api/resources/route.ts");

  it("uses the semester-aware summary", () => {
    assert.match(source, /getAllSubjectsWithReportsBySemester/);
    assert.doesNotMatch(source, /s\.uniqueQuestionCount/);
    assert.doesNotMatch(source, /code: s\.code/);
  });

  it("has a semester-aware summary to read", () => {
    const repo = read("packages/backend/src/database/repositories/AnalysisReportRepository.ts");
    assert.match(repo, /getSubjectsBySemesterSummary/);
    assert.match(repo, /semester: "\$_id\.semester"/);
    // The summary /api/subjects depends on must keep one row per subject: it
    // reports subjects.length as its total.
    const summary = repo.slice(
      repo.indexOf("async getSubjectsSummary"),
      repo.indexOf("Get subjects grouped by branch")
    );
    assert.doesNotMatch(summary, /semester: "\$_id\.semester"/);
  });

  it("stops fabricating a download count", () => {
    assert.doesNotMatch(source, /Math\.random\(\)/);
    assert.match(source, /downloadCount: 0/);
  });

  it("builds titles with the tested helper", () => {
    assert.match(source, /questionTitle\(/);
    assert.doesNotMatch(source, /substring\(0, 50\) \+ "\.\.\."/);
  });

  it("rejects an unknown action or a pyqs request without a subject", () => {
    assert.match(source, /Unsupported action/);
    assert.match(source, /Missing required query parameter: subject/);
  });

  it("reports a real question count", () => {
    assert.match(source, /getQuestionCountsBySubject/);
    const repo = read("packages/backend/src/database/repositories/UniqueQuestionRepository.ts");
    assert.match(repo, /async getQuestionCountsBySubject/);
  });
});

describe("resource page follows the catalogue", () => {
  const source = read("packages/frontend/app/resources/page.tsx");

  it("no longer offers hardcoded branches and semesters", () => {
    assert.doesNotMatch(source, /"Computer Science", "Electrical Engineering"/);
    assert.doesNotMatch(source, /"Semester 8"/);
    assert.match(source, /const branches = resourcesData\?\.branches \?\? \[\]/);
    assert.match(source, /const semesters = resourcesData\?\.semesters \?\? \[\]/);
  });

  it("resets the dependent selections through the tested helpers", () => {
    assert.match(source, /selectBranch\(current, value\)/);
    assert.match(source, /selectSemester\(current, value\)/);
    assert.match(source, /reconcileSelection\(current, resourcesData\)/);
  });

  it("reads stats instead of substituting catalogue totals", () => {
    // "Subjects Covered" used to fall back to subjects.length, the same number
    // for every selected subject.
    assert.match(source, /subjectCount=\{pyqsData\?\.stats\?\.subjectCount \?\? 0\}/);
    assert.match(source, /uniqueQuestions=\{pyqsData\?\.stats\?\.uniqueQuestions \?\? 0\}/);
    assert.doesNotMatch(source, /pyqsData\?\.stats\?\.uniqueQuestions \|\|/);
    assert.doesNotMatch(source, /pyqsData\?\.stats\?\.subjectCount \|\|/);
  });

  it("drives the tabs from state instead of defaultValue", () => {
    assert.match(source, /<Tabs value=\{activeTab\} onValueChange=\{setActiveTab\}>/);
    assert.doesNotMatch(source, /<Tabs defaultValue/);
  });

  it("surfaces a failed PYQ fetch instead of silently showing nothing", () => {
    assert.match(source, /setError\(err\.message \|\| "Failed to load questions"\)/);
  });
});

describe("admin pages that still render mock data", () => {
  // Not fixed here: wiring these to real APIs is a separate change. Recorded so
  // the gap stays visible.
  const mockPages = [
    "packages/frontend/app/admin/page.tsx",
    "packages/frontend/app/admin/users/page.tsx",
    "packages/frontend/app/admin/resources/page.tsx",
    "packages/frontend/app/admin/analytics/page.tsx",
    "packages/frontend/app/admin/settings/page.tsx",
  ];

  it("are all behind the guard", () => {
    assert.ok(read("packages/frontend/app/admin/layout.tsx").includes("resolveIsAdmin"));
    assert.ok(mockPages.every((page) => read(page).length > 0));
  });

  it("fetch nothing from an API yet", () => {
    for (const page of mockPages) {
      assert.doesNotMatch(read(page), /fetch\(/, `${page} still calls the API`);
    }
  });
});
