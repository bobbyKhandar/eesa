/**
 * The student exam browser category chips and quick-action buttons rendered
 * without state or handlers, so clicking them could never filter or navigate.
 * Categories must filter the list, quick actions must apply a real sort/reset,
 * and the Difficulty card (no difficulty field on the payload) must go away.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  EXAM_CATEGORIES,
  filterExamsByCategory,
  matchesCategory,
  sortBrowserExams,
  toggleCategory,
} from "../../../packages/frontend/lib/examBrowserFilters.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const page = readFileSync(join(root, "packages/frontend/app/exams/page.tsx"), "utf8");

const exams = [
  {
    title: "Intro to Programming",
    subject: "Computer Science",
    type: "MCQ",
    description: "Basics",
    degree: "B.Tech",
    duration: 60,
    questions: 10,
    assignedUsers: 5,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    title: "Linear Algebra",
    subject: "Mathematics",
    type: "Theory",
    description: "Vectors",
    degree: "B.Sc",
    duration: 30,
    questions: 20,
    assignedUsers: 50,
    createdAt: "2026-02-01T00:00:00.000Z",
  },
  {
    title: "Web Basics",
    subject: "Web Development",
    type: "Practical",
    description: "HTML",
    degree: "B.Tech",
    duration: 90,
    questions: 5,
    assignedUsers: 50,
    createdAt: "2026-03-01T00:00:00.000Z",
  },
];

describe("matchesCategory", () => {
  it("matches everything when no category is selected", () => {
    assert.equal(matchesCategory(exams[0], null), true);
    assert.equal(matchesCategory(exams[0], ""), true);
    assert.equal(matchesCategory(exams[0], "All"), true);
  });

  it("matches the subject case-insensitively", () => {
    assert.equal(matchesCategory(exams[0], "computer science"), true);
    assert.equal(matchesCategory(exams[1], "computer science"), false);
  });

  it("also matches type, title, description, and degree", () => {
    assert.equal(matchesCategory({ type: "Programming Lab" }, "Programming"), true);
    assert.equal(matchesCategory({ title: "Physics 101" }, "Physics"), true);
    assert.equal(matchesCategory(exams[0], "basics"), true);
    assert.equal(matchesCategory(exams[0], "b.tech"), true);
  });
});

describe("filterExamsByCategory", () => {
  it("keeps every exam when no category is selected", () => {
    assert.deepEqual(filterExamsByCategory(exams, null), exams);
  });

  it("keeps only exams in the selected category", () => {
    assert.deepEqual(filterExamsByCategory(exams, "Mathematics"), [exams[1]]);
    assert.deepEqual(filterExamsByCategory(exams, "Physics"), []);
  });
});

describe("toggleCategory", () => {
  it("selects a new chip and clears the active chip on repeat click", () => {
    assert.equal(toggleCategory(null, "Physics"), "Physics");
    assert.equal(toggleCategory("Physics", "Physics"), null);
    assert.equal(toggleCategory("Physics", "Mathematics"), "Mathematics");
  });
});

describe("sortBrowserExams", () => {
  it("orders recent exams newest first", () => {
    assert.deepEqual(
      sortBrowserExams(exams, "recent").map((exam) => exam.title),
      ["Web Basics", "Linear Algebra", "Intro to Programming"],
    );
  });

  it("orders popular exams by enrolled users, then question count", () => {
    assert.deepEqual(
      sortBrowserExams(exams, "popular").map((exam) => exam.title),
      ["Linear Algebra", "Web Basics", "Intro to Programming"],
    );
  });

  it("supports the existing alphabetical and duration orders", () => {
    assert.deepEqual(
      sortBrowserExams(exams, "alphabetical").map((exam) => exam.title),
      ["Intro to Programming", "Linear Algebra", "Web Basics"],
    );
    assert.deepEqual(
      sortBrowserExams(exams, "duration").map((exam) => exam.title),
      ["Linear Algebra", "Intro to Programming", "Web Basics"],
    );
  });
});

describe("exams page wires every browser control", () => {
  it("renders category chips from state with a toggle handler", () => {
    assert.match(page, /EXAM_CATEGORIES\.map/);
    assert.match(page, /toggleCategory\(selectedCategory, category\)/);
    assert.match(page, /filterExamsByCategory\(searchedExams, selectedCategory\)/);
    assert.match(page, /aria-pressed=\{active\}/);
    assert.match(page, /Filtering by \{selectedCategory\}/);
  });

  it("removes the Difficulty affordance that has no backing field", () => {
    assert.doesNotMatch(page, /<CardTitle>Difficulty<\/CardTitle>/);
    assert.doesNotMatch(page, /Beginner/);
    assert.doesNotMatch(page, /Intermediate/);
    assert.doesNotMatch(page, /Advanced/);
  });

  it("gives each quick action a real filter or sort", () => {
    assert.match(page, /My Enrolled Exams/);
    assert.match(page, /onClick=\{resetBrowserFilters\}/);
    assert.match(page, /onClick=\{\(\) => setSortBy\("recent"\)\}/);
    assert.match(page, /onClick=\{\(\) => setSortBy\("popular"\)\}/);
    assert.match(page, /sortBrowserExams\(filteredExams, sortBy\)/);
    assert.match(page, /<SelectItem value="popular">/);
  });

  it("keeps the status tabs and sort select controlled so resets apply", () => {
    assert.match(page, /<Tabs value=\{filterStatus\}/);
    assert.doesNotMatch(page, /<Tabs defaultValue/);
    assert.match(page, /<Select value=\{sortBy\} onValueChange=\{setSortBy\}>/);
  });

  it("lists the expected categories", () => {
    assert.deepEqual([...EXAM_CATEGORIES], [
      "Computer Science",
      "Data Science",
      "Web Development",
      "Programming",
      "Mathematics",
      "Physics",
    ]);
  });
});
