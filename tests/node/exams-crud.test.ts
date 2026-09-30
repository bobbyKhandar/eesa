import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_EXAM_DURATION_MINUTES,
  DEFAULT_NEGATIVE_MARKING_PERCENTAGE,
  computeNegativeMarks,
  findInvalidQuestion,
  findInvalidSettings,
  normalizeAssignedUsers,
  parseScheduledAt,
  resolveDuration,
  resolveNegativeMarkingPercentage,
} from "../../packages/frontend/lib/examCreation.ts";

describe("negative marking percentage", () => {
  it("keeps an explicit 0 instead of falling back to the default", () => {
    assert.equal(resolveNegativeMarkingPercentage(0), 0);
  });

  it("keeps a value inside the allowed range", () => {
    assert.equal(resolveNegativeMarkingPercentage(33.5), 33.5);
  });

  it("falls back to the default for missing, non-numeric, infinite or out-of-range values", () => {
    for (const value of [undefined, null, "25", Number.NaN, Infinity, -1, 101]) {
      assert.equal(resolveNegativeMarkingPercentage(value), DEFAULT_NEGATIVE_MARKING_PERCENTAGE);
    }
  });
});

describe("computeNegativeMarks", () => {
  it("deducts nothing when negative marking is disabled", () => {
    assert.equal(computeNegativeMarks(10, false, 25), 0);
  });

  it("deducts nothing when 0% is requested", () => {
    assert.equal(computeNegativeMarks(10, true, 0), 0);
  });

  it("deducts the requested share of the question marks", () => {
    assert.equal(computeNegativeMarks(10, true, 25), 2.5);
  });

  it("falls back to the default percentage when none was sent", () => {
    assert.equal(computeNegativeMarks(20, true, undefined), 5);
  });
});

describe("resolveDuration", () => {
  it("keeps a positive duration", () => {
    assert.equal(resolveDuration(45), 45);
  });

  it("falls back to the default for missing, zero, negative or non-numeric durations", () => {
    for (const value of [undefined, null, 0, -30, Number.NaN, "60"]) {
      assert.equal(resolveDuration(value), DEFAULT_EXAM_DURATION_MINUTES);
    }
  });
});

describe("findInvalidQuestion", () => {
  it("rejects an empty question list", () => {
    assert.equal(findInvalidQuestion([]), "At least one question is required");
    assert.equal(findInvalidQuestion(undefined), "At least one question is required");
  });

  it("rejects a question without text", () => {
    assert.equal(
      findInvalidQuestion([{ text: "What is 2 + 2?", marks: 5 }, { text: "  ", marks: 5 }]),
      "Question 2 is missing its text"
    );
  });

  it("rejects marks that are not positive finite numbers", () => {
    assert.equal(
      findInvalidQuestion([{ text: "What is 2 + 2?", marks: Number.NaN }]),
      "Question 1 must have positive marks"
    );
    assert.equal(
      findInvalidQuestion([{ text: "What is 2 + 2?", marks: 0 }]),
      "Question 1 must have positive marks"
    );
    assert.equal(
      findInvalidQuestion([{ text: "What is 2 + 2?", marks: "5" }]),
      "Question 1 must have positive marks"
    );
  });

  it("accepts a valid list", () => {
    assert.equal(
      findInvalidQuestion([
        { text: "What is 2 + 2?", marks: 5, type: "TEXT" },
        { text: "Name the capital of France.", marks: 2.5, type: "MCQ" },
      ]),
      null
    );
  });
});

describe("findInvalidSettings", () => {
  it("accepts the defaults sent by the create form", () => {
    assert.equal(
      findInvalidSettings({
        passingPercentage: 35,
        duration: 60,
        negativeMarking: false,
        negativeMarkingPercentage: 25,
      }),
      null
    );
  });

  it("rejects a passing percentage outside 0-100", () => {
    assert.equal(
      findInvalidSettings({ passingPercentage: 140, duration: 60, negativeMarking: false, negativeMarkingPercentage: 25 }),
      "passingPercentage must be a number between 0 and 100"
    );
  });

  it("rejects a non-positive duration", () => {
    assert.equal(
      findInvalidSettings({ passingPercentage: 35, duration: 0, negativeMarking: false, negativeMarkingPercentage: 25 }),
      "duration must be a positive number of minutes"
    );
  });

  it("allows a missing duration so the default applies", () => {
    assert.equal(
      findInvalidSettings({
        passingPercentage: 35,
        duration: undefined,
        negativeMarking: false,
        negativeMarkingPercentage: 25,
      }),
      null
    );
  });

  it("requires a valid percentage only when negative marking is enabled", () => {
    assert.equal(
      findInvalidSettings({
        passingPercentage: 35,
        duration: 60,
        negativeMarking: true,
        negativeMarkingPercentage: undefined,
      }),
      "negativeMarkingPercentage must be a number between 0 and 100 when negative marking is enabled"
    );
    assert.equal(
      findInvalidSettings({
        passingPercentage: 35,
        duration: 60,
        negativeMarking: true,
        negativeMarkingPercentage: 0,
      }),
      null
    );
  });
});

describe("normalizeAssignedUsers", () => {
  it("always includes the creator", () => {
    assert.deepEqual(normalizeAssignedUsers([], "user_creator"), ["user_creator"]);
  });

  it("keeps the requested assignees without duplicating the creator", () => {
    assert.deepEqual(normalizeAssignedUsers(["user_a", "user_creator", "user_a"], "user_creator"), [
      "user_a",
      "user_creator",
    ]);
  });

  it("drops values that are not usable ids", () => {
    assert.deepEqual(normalizeAssignedUsers(["user_a", "", "   ", null, 7, undefined], "user_creator"), [
      "user_a",
      "user_creator",
    ]);
  });

  it("tolerates a non-array examUsers value", () => {
    assert.deepEqual(normalizeAssignedUsers(undefined, "user_creator"), ["user_creator"]);
  });
});

describe("parseScheduledAt", () => {
  it("parses an ISO timestamp", () => {
    assert.equal(parseScheduledAt("2026-10-01T10:30:00.000Z")?.toISOString(), "2026-10-01T10:30:00.000Z");
  });

  it("passes a Date through", () => {
    const date = new Date("2026-10-01T10:30:00.000Z");
    assert.equal(parseScheduledAt(date)?.toISOString(), date.toISOString());
  });

  it("returns undefined for empty or unparseable values", () => {
    for (const value of [undefined, null, "", "not-a-date", {}]) {
      assert.equal(parseScheduledAt(value), undefined);
    }
  });
});
