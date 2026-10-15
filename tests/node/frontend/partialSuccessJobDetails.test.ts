/**
 * Admin job details must surface extracted questions for partial-success
 * jobs (#85). The details modal used to gate its Processed Questions section
 * on `status === 'success'`, hiding questions extracted before a later stage
 * failed, even though the job list already treats `partial_success` as
 * retryable/filterable.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  getIncompleteJobStages,
  shouldShowJobQuestions,
} from "../../../packages/frontend/lib/jobStatus.ts";

describe("shouldShowJobQuestions", () => {
  it("shows questions for success and partial_success", () => {
    assert.equal(shouldShowJobQuestions("success"), true);
    assert.equal(shouldShowJobQuestions("partial_success"), true);
  });

  it("hides questions for failed and in-progress jobs", () => {
    for (const status of ["failed", "in_progress", "pending", "", undefined, null]) {
      assert.equal(shouldShowJobQuestions(status), false, String(status));
    }
  });
});

describe("getIncompleteJobStages", () => {
  it("lists stages that did not succeed", () => {
    assert.deepEqual(
      getIncompleteJobStages({
        ocr: { status: "success" },
        parsing: { status: "success" },
        enrichment: { status: "failed" },
        organization: { status: "pending" },
      }),
      ["enrichment", "organization"]
    );
  });

  it("returns an empty list when every stage succeeded", () => {
    assert.deepEqual(
      getIncompleteJobStages({
        ocr: { status: "success" },
        parsing: { status: "success" },
        enrichment: { status: "success" },
        organization: { status: "success" },
      }),
      []
    );
  });

  it("treats missing stages as incomplete", () => {
    assert.deepEqual(getIncompleteJobStages(null), [
      "ocr",
      "parsing",
      "enrichment",
      "organization",
    ]);
    assert.deepEqual(getIncompleteJobStages({ ocr: { status: "success" } }), [
      "parsing",
      "enrichment",
      "organization",
    ]);
  });
});

describe("admin job details modal handles partial_success (#85)", () => {
  const source = readFileSync(
    "packages/frontend/app/admin/upload/question-papers/page.tsx",
    "utf8"
  );

  it("fetches and renders questions for partial-success jobs", () => {
    assert.match(source, /shouldShowJobQuestions/);
    // The questions section must not be gated on success alone.
    assert.doesNotMatch(source, /selectedJobDetails\.status === 'success' &&/);
    assert.match(source, /shouldShowJobQuestions\(selectedJobDetails\.status\)/);
    assert.match(source, /shouldShowJobQuestions\(data\.status\)/);
  });

  it("marks incomplete stages on partial-success jobs", () => {
    assert.match(source, /getIncompleteJobStages\(selectedJobDetails\.stages\)/);
    assert.match(source, /Incomplete stages/);
    assert.match(source, /Partial (results|success)/);
  });

  it("offers retry from the details modal for retryable jobs", () => {
    assert.match(source, /isRetryableJobStatus\(selectedJobDetails\.status\)/);
    assert.match(source, /Retry incomplete stages|Retry/);
  });
});
