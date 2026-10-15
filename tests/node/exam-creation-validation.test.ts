import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  findExamDetailsFieldErrors,
  findExamSettingsFieldErrors,
  findInvalidExamDetails,
  findInvalidSettings,
} from "../../packages/frontend/lib/examCreation.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("findExamDetailsFieldErrors trims required fields", () => {
  it("accepts values with surrounding whitespace", () => {
    assert.deepEqual(
      findExamDetailsFieldErrors({
        examTitle: "  Midterm  ",
        examDescription: "  Covers chapters 1-3  ",
        subject: " Physics ",
        examDegree: " B.Tech ",
      }),
      {}
    );
  });

  it("rejects whitespace-only, empty, and non-string values per field", () => {
    assert.deepEqual(
      findExamDetailsFieldErrors({
        examTitle: "   ",
        examDescription: "",
        subject: undefined,
        examDegree: "B.Tech",
      }),
      {
        examTitle: "Exam title is required",
        examDescription: "Description is required",
        subject: "Subject is required",
      }
    );
  });

  it("reports the first missing field through findInvalidExamDetails", () => {
    assert.equal(
      findInvalidExamDetails({
        examTitle: "Midterm",
        examDescription: "  ",
        subject: "Physics",
        examDegree: "B.Tech",
      }),
      "Description is required"
    );
    assert.equal(
      findInvalidExamDetails({
        examTitle: "Midterm",
        examDescription: "Covers chapters 1-3",
        subject: "Physics",
        examDegree: "B.Tech",
      }),
      null
    );
  });
});

describe("findExamSettingsFieldErrors mirrors the API checks per field", () => {
  it("accepts the defaults sent by the create form", () => {
    assert.deepEqual(
      findExamSettingsFieldErrors({
        passingPercentage: 35,
        duration: 60,
        negativeMarking: false,
        negativeMarkingPercentage: 25,
      }),
      {}
    );
  });

  it("flags each invalid setting on its own field", () => {
    assert.deepEqual(
      findExamSettingsFieldErrors({
        passingPercentage: 140,
        duration: 60,
        negativeMarking: false,
        negativeMarkingPercentage: 25,
      }),
      { passingPercentage: "passingPercentage must be a number between 0 and 100" }
    );
    assert.deepEqual(
      findExamSettingsFieldErrors({
        passingPercentage: 35,
        duration: 0,
        negativeMarking: false,
        negativeMarkingPercentage: 25,
      }),
      { duration: "duration must be a positive number of minutes" }
    );
    assert.deepEqual(
      findExamSettingsFieldErrors({
        passingPercentage: 35,
        duration: 60,
        negativeMarking: true,
        negativeMarkingPercentage: 101,
      }),
      {
        negativeMarkingPercentage:
          "negativeMarkingPercentage must be a number between 0 and 100 when negative marking is enabled",
      }
    );
  });

  it("stays consistent with findInvalidSettings", () => {
    const invalid = {
      passingPercentage: 140,
      duration: 0,
      negativeMarking: true,
      negativeMarkingPercentage: 101,
    };
    const fields = findExamSettingsFieldErrors(invalid);
    assert.equal(findInvalidSettings(invalid), fields.passingPercentage);
    assert.equal(
      findInvalidSettings({
        passingPercentage: 35,
        duration: 0,
        negativeMarking: false,
        negativeMarkingPercentage: 25,
      }),
      "duration must be a positive number of minutes"
    );
  });
});

describe("exam creation page validates before submitting", () => {
  it("submits through a form so browser required/min/max constraints run", () => {
    const page = read("packages/frontend/app/dashboard/exams/create/page.tsx");
    assert.match(page, /<form onSubmit=\{handleSubmit\}/);
    assert.match(page, /type="submit"/);
    assert.match(page, /min="1"/);
  });

  it("checks trimmed details and shared settings client-side with field-level feedback", () => {
    const page = read("packages/frontend/app/dashboard/exams/create/page.tsx");
    assert.match(page, /findExamDetailsFieldErrors\(\{ examTitle, examDescription, subject, examDegree \}\)/);
    assert.match(page, /findExamSettingsFieldErrors\(\{/);
    assert.match(page, /role="alert"/);
    assert.doesNotMatch(page, /if \(!examTitle \|\| !examDescription \|\| !subject \|\| !examDegree\)/);
  });
});
