/**
 * The resources page type select must decide which lists are on screen, and
 * the search box must name — and query — only that list.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  activeResourceSection,
  filterNotesByQuery,
  filterPyqsByQuery,
  resourceEmptyMessage,
  resourceScopeMessage,
  resourceSearchPlaceholder,
  visibleResourceSections,
} from "../../../packages/frontend/lib/resourceFilters.ts";

const RESOURCES_PAGE = "packages/frontend/app/resources/page.tsx";
const SEARCH_BAR = "packages/frontend/components/features/resources/SearchFilterBar.tsx";

const pyqs = [
  { title: "Stack operations", questionText: "Push and pop", topic: "Stacks" },
  { title: "Graph walks", questionText: "Traverse a graph", topic: "Graphs" },
];

const notes = [
  {
    title: "Tree notes",
    description: "Balanced trees",
    uploadedBy: "Prof. Chen",
    tags: ["Trees", "BST"],
  },
  {
    title: "Sorting sheet",
    description: "Quick reference",
    uploadedBy: "Alex Johnson",
    tags: ["Sorting"],
  },
];

describe("resource type filter", () => {
  it("shows every section until a specific type is chosen", () => {
    assert.deepEqual(visibleResourceSections("all"), ["pyqs", "faculty", "student"]);
    assert.deepEqual(visibleResourceSections(""), ["pyqs", "faculty", "student"]);
    assert.deepEqual(visibleResourceSections("papers"), ["pyqs", "faculty", "student"]);
  });

  it("limits the page to the selected type", () => {
    assert.deepEqual(visibleResourceSections("pyqs"), ["pyqs"]);
    assert.deepEqual(visibleResourceSections("faculty"), ["faculty"]);
    assert.deepEqual(visibleResourceSections("student"), ["student"]);
  });

  it("follows the open tab while all types are shown, and the type filter otherwise", () => {
    assert.equal(activeResourceSection("all", "student"), "student");
    assert.equal(activeResourceSection("all", "missing"), "pyqs");
    assert.equal(activeResourceSection("faculty", "pyqs"), "faculty");
  });
});

describe("resource search scope", () => {
  it("matches previous papers by title, question text, or topic", () => {
    assert.deepEqual(filterPyqsByQuery(pyqs, "graph"), [pyqs[1]]);
    assert.deepEqual(filterPyqsByQuery(pyqs, "PUSH"), [pyqs[0]]);
    assert.deepEqual(filterPyqsByQuery(pyqs, "stacks"), [pyqs[0]]);
    assert.deepEqual(filterPyqsByQuery(pyqs, "   "), pyqs);
    assert.deepEqual(filterPyqsByQuery(pyqs, "queues"), []);
  });

  it("matches notes by title, description, author, or tag", () => {
    assert.deepEqual(filterNotesByQuery(notes, "balanced"), [notes[0]]);
    assert.deepEqual(filterNotesByQuery(notes, "chen"), [notes[0]]);
    assert.deepEqual(filterNotesByQuery(notes, "BST"), [notes[0]]);
    assert.deepEqual(filterNotesByQuery(notes, "sorting"), [notes[1]]);
    assert.deepEqual(filterNotesByQuery(notes, ""), notes);
  });

  it("names the list the query applies to", () => {
    assert.equal(resourceSearchPlaceholder("pyqs"), "Search previous papers");
    assert.equal(resourceSearchPlaceholder("faculty"), "Search faculty notes");
    assert.equal(resourceSearchPlaceholder("student"), "Search student notes");
    assert.equal(
      resourceScopeMessage("faculty", "faculty"),
      "Showing faculty notes only. Search applies to this list."
    );
    assert.equal(
      resourceScopeMessage("all", "pyqs"),
      "Showing all resource types. Search applies to previous papers."
    );
    assert.equal(resourceEmptyMessage("student", "stacks"), 'No student notes match "stacks".');
    assert.equal(resourceEmptyMessage("pyqs", "  "), "No previous papers to show.");
  });
});

describe("resources page applies the type filter", () => {
  it("filters each displayed list and states the search scope", () => {
    const page = readFileSync(RESOURCES_PAGE, "utf8");
    const bar = readFileSync(SEARCH_BAR, "utf8");

    assert.match(page, /visibleResourceSections\(filterType\)/);
    assert.match(page, /activeResourceSection\(filterType, activeTab\)/);
    assert.match(page, /filterPyqsByQuery\(/);
    assert.match(page, /filterNotesByQuery\(\s*facultyNotes/);
    assert.match(page, /filterNotesByQuery\(\s*studentNotes/);
    assert.match(page, /sections\.includes\("pyqs"\)/);
    assert.match(page, /sections\.includes\("faculty"\)/);
    assert.match(page, /sections\.includes\("student"\)/);
    assert.match(page, /resourceSearchPlaceholder\(activeSection\)/);
    assert.match(page, /resourceScopeMessage\(filterType, activeSection\)/);
    assert.match(page, /<Tabs value=\{activeSection\} onValueChange=\{setActiveTab\}>/);
    assert.doesNotMatch(page, /<Tabs defaultValue/);

    assert.match(bar, /placeholder=\{searchPlaceholder\}/);
    assert.match(bar, /\{scopeMessage\}/);
    assert.doesNotMatch(bar, /Search resources\.\.\./);
  });
});
