/**
 * A failed subject question-bank request used to clear the list and render
 * "No reports found" / "No unique questions found". An error must stay
 * distinct from an empty catalog, and each failed section needs its own retry.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  subjectCatalogErrorMessage,
  subjectCatalogView,
} from "../../../packages/frontend/lib/subjectCatalogLoad.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const page = readFileSync(
  join(root, "packages/frontend/app/subjects/[subjectName]/page.tsx"),
  "utf8",
);

describe("subjectCatalogView", () => {
  it("treats a failed request with no rows as an error, not an empty catalog", () => {
    assert.equal(
      subjectCatalogView({
        loading: false,
        error: "Failed to load reports (500)",
        itemCount: 0,
      }),
      "error",
    );
    assert.equal(
      subjectCatalogView({
        loading: false,
        error: "Failed to load unique questions (502)",
        itemCount: 0,
      }),
      "error",
    );
  });

  it("treats a successful response with no rows as empty", () => {
    assert.equal(subjectCatalogView({ loading: false, error: null, itemCount: 0 }), "empty");
    assert.equal(subjectCatalogView({ loading: false, error: "   ", itemCount: 0 }), "empty");
    assert.equal(subjectCatalogView({ loading: false, error: undefined, itemCount: 0 }), "empty");
  });

  it("shows rows only when the request succeeded", () => {
    assert.equal(subjectCatalogView({ loading: false, error: null, itemCount: 2 }), "ready");
    assert.equal(
      subjectCatalogView({
        loading: false,
        error: "Failed to load reports (500)",
        itemCount: 2,
      }),
      "error",
    );
  });

  it("keeps the loading state in front of a leftover error while a retry is in flight", () => {
    assert.equal(
      subjectCatalogView({
        loading: true,
        error: "Failed to load reports (500)",
        itemCount: 0,
      }),
      "loading",
    );
  });
});

describe("subjectCatalogErrorMessage", () => {
  it("keeps an HTTP failure message from the request", () => {
    assert.equal(
      subjectCatalogErrorMessage("reports", new Error("Failed to load reports (503)")),
      "Failed to load reports (503)",
    );
    assert.equal(
      subjectCatalogErrorMessage(
        "unique-questions",
        new Error("Failed to load unique questions (404)"),
      ),
      "Failed to load unique questions (404)",
    );
  });

  it("replaces a bare network failure with a section-specific message", () => {
    assert.equal(
      subjectCatalogErrorMessage("reports", new TypeError("Failed to fetch")),
      "Unable to load reports. Check your connection and try again.",
    );
    assert.equal(
      subjectCatalogErrorMessage("unique-questions", new TypeError("Failed to fetch")),
      "Unable to load unique questions. Check your connection and try again.",
    );
  });

  it("falls back when the rejection is not an Error", () => {
    assert.equal(
      subjectCatalogErrorMessage("reports", "nope"),
      "Unable to load reports. Check your connection and try again.",
    );
  });
});

describe("subject question-bank page", () => {
  it("records a section error instead of presenting a failed request as an empty list", () => {
    assert.match(page, /setReportsError\(subjectCatalogErrorMessage\("reports", error\)\)/);
    assert.match(
      page,
      /setUniqueQuestionsError\(subjectCatalogErrorMessage\("unique-questions", error\)\)/,
    );
    assert.match(page, /subjectCatalogView\(\{[^}]*error: reportsError/s);
    assert.match(page, /subjectCatalogView\(\{[^}]*error: uniqueQuestionsError/s);
  });

  it("renders an error state and a retry button for each failed section", () => {
    const reportsError = page.indexOf('reportsView === "error"');
    const reportsEmpty = page.indexOf('reportsView === "empty"');
    const questionsError = page.indexOf('questionsView === "error"');
    const questionsEmpty = page.indexOf('questionsView === "empty"');

    assert.ok(reportsError >= 0, "reports section has no error state");
    assert.ok(reportsEmpty > reportsError, "empty reports state must follow the error state");
    assert.ok(questionsError >= 0, "unique questions section has no error state");
    assert.ok(
      questionsEmpty > questionsError,
      "empty questions state must follow the error state",
    );

    assert.match(page, /Unable to load reports/);
    assert.match(page, /Unable to load unique questions/);
    assert.match(page, /Retry loading reports/);
    assert.match(page, /onClick=\{\(\) => void fetchReports\(\)\}/);
    assert.match(page, /Retry loading unique questions/);
    assert.match(page, /onClick=\{\(\) => void fetchUniqueQuestions\(\)\}/);

    const reportsEmptyCopy = page.indexOf("No reports found");
    const questionsEmptyCopy = page.indexOf("No unique questions found");
    assert.ok(reportsEmptyCopy > reportsEmpty, "empty reports copy must live in the empty state");
    assert.ok(
      questionsEmptyCopy > questionsEmpty,
      "empty questions copy must live in the empty state",
    );
  });
});
