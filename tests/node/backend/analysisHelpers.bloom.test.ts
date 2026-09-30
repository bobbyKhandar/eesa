import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  BLOOM_LEVELS,
  calculateBloomDistribution,
  emptyBloomDistribution,
  mapBloomLevelToPromptFormat,
  normalizeBloomLevel,
  normalizeQuestionText,
  roundBloomDistribution,
  sanitizeBloomDistribution,
} from "../../../packages/backend/src/services/analysisHelpers.ts";

const totalOf = (distribution: Record<string, number>) =>
  BLOOM_LEVELS.reduce((sum, level) => sum + distribution[level], 0);

describe("normalizeBloomLevel", () => {
  it("normalizes known labels and aliases", () => {
    assert.equal(normalizeBloomLevel("Recall"), "Recall");
    assert.equal(normalizeBloomLevel("  REMEMBER "), "Recall");
    assert.equal(normalizeBloomLevel("analyze"), "Analyze");
    assert.equal(normalizeBloomLevel("Evaluation"), "Evaluate");
  });

  it("returns null for unrecognisable labels instead of inventing a bucket", () => {
    assert.equal(normalizeBloomLevel("Bloomish"), null);
    assert.equal(normalizeBloomLevel(""), null);
    assert.equal(normalizeBloomLevel(null), null);
    assert.equal(normalizeBloomLevel(undefined), null);
    assert.equal(normalizeBloomLevel(42 as unknown as string), null);
  });
});

describe("mapBloomLevelToPromptFormat", () => {
  it("maps to the casing used by Prompt/UniqueQuestion schemas", () => {
    assert.equal(mapBloomLevelToPromptFormat("Recall"), "remember");
    assert.equal(mapBloomLevelToPromptFormat("Remember"), "remember");
    assert.equal(mapBloomLevelToPromptFormat("Create"), "create");
  });

  it("falls back to understand for unknown levels", () => {
    assert.equal(mapBloomLevelToPromptFormat("nonsense"), "understand");
    assert.equal(mapBloomLevelToPromptFormat(null), "understand");
  });
});

describe("normalizeQuestionText", () => {
  it("lowercases, strips punctuation and collapses whitespace", () => {
    assert.equal(
      normalizeQuestionText("  What is  2 + 2?  "),
      "what is 2 2"
    );
  });

  it("treats missing text as empty", () => {
    assert.equal(normalizeQuestionText(undefined), "");
    assert.equal(normalizeQuestionText(null), "");
  });

  it("collapses punctuation-only differences into the same key", () => {
    assert.equal(
      normalizeQuestionText("Define a *binary tree*."),
      normalizeQuestionText("define a binary tree")
    );
  });
});

describe("calculateBloomDistribution", () => {
  it("returns all six levels, summing to 100", () => {
    const distribution = calculateBloomDistribution([
      { bloomLevel: "Recall", marks: 5 },
      { bloomLevel: "Apply", marks: 5 },
    ]);

    assert.deepEqual(Object.keys(distribution).sort(), [...BLOOM_LEVELS].sort());
    assert.equal(distribution.Recall, 50);
    assert.equal(distribution.Apply, 50);
    assert.ok(Math.abs(totalOf(distribution) - 100) < 0.01);
  });

  it("does not produce NaN when every question has zero marks", () => {
    const distribution = calculateBloomDistribution([
      { bloomLevel: "Recall", marks: 0 },
      { bloomLevel: "Apply", marks: 0 },
    ]);

    for (const level of BLOOM_LEVELS) {
      assert.ok(Number.isFinite(distribution[level]), `${level} must be finite`);
    }
    assert.ok(Math.abs(totalOf(distribution) - 100) < 0.01);
  });

  it("does not produce NaN when marks are missing entirely", () => {
    const distribution = calculateBloomDistribution([
      { bloomLevel: "Recall" },
      { bloomLevel: "Analyze" },
    ]);

    for (const level of BLOOM_LEVELS) {
      assert.ok(Number.isFinite(distribution[level]), `${level} must be finite`);
    }
    assert.ok(Math.abs(totalOf(distribution) - 100) < 0.01);
  });

  it("returns an empty distribution for an empty question list", () => {
    assert.deepEqual(calculateBloomDistribution([]), emptyBloomDistribution());
  });

  it("ignores unknown bloom levels instead of creating a bogus bucket", () => {
    const distribution = calculateBloomDistribution([
      { bloomLevel: "Bloomish", marks: 10 },
      { bloomLevel: "Recall", marks: 10 },
    ]);

    assert.deepEqual(Object.keys(distribution).sort(), [...BLOOM_LEVELS].sort());
    assert.equal(distribution.Recall, 100);
  });

  it("treats negative marks as zero", () => {
    const distribution = calculateBloomDistribution([
      { bloomLevel: "Recall", marks: -10 },
      { bloomLevel: "Recall", marks: 10 },
    ]);

    assert.equal(distribution.Recall, 100);
  });
});

describe("roundBloomDistribution", () => {
  it("rounds to two decimals and fills missing levels with zero", () => {
    const rounded = roundBloomDistribution({
      Recall: 33.333333333,
    } as never);

    assert.equal(rounded.Recall, 33.33);
    assert.equal(rounded.Create, 0);
  });
});
describe("sanitizeBloomDistribution", () => {
  it("fills missing levels with zero", () => {
    assert.deepEqual(sanitizeBloomDistribution({ Recall: 40 }), {
      Recall: 40,
      Understand: 0,
      Apply: 0,
      Analyze: 0,
      Evaluate: 0,
      Create: 0,
    });
  });

  it("returns an empty distribution for null/undefined", () => {
    assert.deepEqual(sanitizeBloomDistribution(null), emptyBloomDistribution());
    assert.deepEqual(sanitizeBloomDistribution(undefined), emptyBloomDistribution());
  });

  it("drops values that would break the schema's 0..100 range", () => {
    const safe = sanitizeBloomDistribution({
      Recall: -5,
      Apply: 140,
      Analyze: Number.NaN,
      Evaluate: "20",
    } as never);

    assert.equal(safe.Recall, 0);
    assert.equal(safe.Apply, 100);
    assert.equal(safe.Analyze, 0);
    assert.equal(safe.Evaluate, 0);
  });
});
