import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

const CREATE_PAGE = "packages/frontend/app/dashboard/exams/create/page.tsx";

describe("exam creation Save as Draft button is honest (#56)", () => {
  it("is disabled unconditionally with an explanation, not just while processing", () => {
    const page = read(CREATE_PAGE);
    assert.match(page, /Save as Draft/);
    // The button must stay disabled even when the form is idle, because no
    // draft API exists to call. Gating only on `processingRequest` would imply
    // it becomes clickable once idle while still doing nothing.
    assert.doesNotMatch(page, /disabled=\{processingRequest\}>Save as Draft/);
    const buttonStart = page.indexOf("Save as Draft") - 400;
    const buttonBlock = page.slice(Math.max(0, buttonStart), page.indexOf("Save as Draft"));
    assert.match(buttonBlock, /disabled/);
    assert.match(buttonBlock, /title="[^"]*[Dd]raft[^"]*not available[^"]*"/);
  });

  it("shows a visible caption explaining drafts cannot be saved yet", () => {
    const page = read(CREATE_PAGE);
    assert.match(page, /Draft saving is not available yet/);
  });

  it("wires no draft click handler or draft API call", () => {
    const page = read(CREATE_PAGE);
    const draftIdx = page.indexOf("Save as Draft");
    const buttonBlock = page.slice(Math.max(0, draftIdx - 400), draftIdx);
    assert.doesNotMatch(buttonBlock, /onClick/);
    assert.doesNotMatch(page, /api\/exams\/draft/i);
    assert.doesNotMatch(page, /saveDraft|saveAsDraft/i);
  });

  it("backend has no exam draft field, so disabling is correct over inventing one", () => {
    const schema = read("packages/backend/src/database/schemas/examSchemaZod.ts");
    assert.doesNotMatch(schema, /isDraft/);
    assert.doesNotMatch(schema, /^\s*status\s*:/m);
    const createRoute = read("packages/frontend/app/api/exams/create/route.ts");
    assert.doesNotMatch(createRoute, /draft/i);
  });
});
