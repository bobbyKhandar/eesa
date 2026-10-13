/**
 * Exam creation must not offer a personal syllabus file upload until a syllabus
 * is actually stored and associated with the exam.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

const CREATE_PAGE = "packages/frontend/app/dashboard/exams/create/page.tsx";
const CREATE_ROUTE = "packages/frontend/app/api/exams/create/route.ts";
const SYLLABUS_SELECTOR = "packages/frontend/components/features/exams/SyllabusTypeSelector.tsx";

const NOT_SAVED = "A syllabus file is not saved with this exam.";

describe("personal syllabus upload is not offered during exam creation", () => {
  it("does not render a file input or upload action on the personal path", () => {
    const page = read(CREATE_PAGE);
    const personalIndex = page.indexOf('syllabusType === "personal"');
    assert.ok(personalIndex > -1);
    const personalBlock = page.slice(personalIndex);

    assert.match(personalBlock, new RegExp(NOT_SAVED.replace(/[.]/g, "\\.")));
    assert.doesNotMatch(page, /type="file"/);
    assert.doesNotMatch(page, /htmlFor="syllabus"/);
    assert.doesNotMatch(page, /Upload Syllabus/);
    assert.doesNotMatch(page, /from "lucide-react"[^"]*Upload/);
    assert.doesNotMatch(page, /<Upload[\s/>]/);
  });

  it("does not promise an upload from the syllabus type selector", () => {
    const selector = read(SYLLABUS_SELECTOR);

    assert.match(selector, /onSelect\("personal"\)/);
    assert.match(selector, /onSelect\("pre-uploaded"\)/);
    assert.match(selector, new RegExp(NOT_SAVED.replace(/[.]/g, "\\.")));
    assert.doesNotMatch(selector, /Upload or create your own custom syllabus/);
    assert.doesNotMatch(selector, /Upload/);
  });

  it("keeps syllabus fields out of the create payload and create route", () => {
    const page = read(CREATE_PAGE);
    const route = read(CREATE_ROUTE);

    assert.doesNotMatch(page, /syllabusFile/);
    assert.doesNotMatch(page, /syllabusId/);
    assert.doesNotMatch(page, /\bsyllabus\s*:/);
    assert.match(page, /questions: toCreateExamQuestions\(questions\)/);
    assert.match(page, /examUsers: examUsersForCreation\(examType, selectedStudentIds\)/);
    assert.match(page, /findMissingStudentAssignees\(examType, selectedStudentIds\)/);
    assert.doesNotMatch(route, /syllabus/);
  });
});
