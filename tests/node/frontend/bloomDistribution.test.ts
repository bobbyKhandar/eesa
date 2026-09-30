import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  BLOOM_LEVELS,
  sanitizeBloomDistribution,
  toBloomRows,
} from "../../../packages/frontend/lib/bloomDistribution.ts";

describe("sanitizeBloomDistribution", () => {
  it("returns zeros when the distribution is missing", () => {
    assert.deepEqual(sanitizeBloomDistribution(undefined), {
      Recall: 0,
      Understand: 0,
      Apply: 0,
      Analyze: 0,
      Evaluate: 0,
      Create: 0,
    });
  });

  it("coerces null and non-numeric values to zero", () => {
    const result = sanitizeBloomDistribution({
      Recall: 25,
      Understand: null,
      Apply: "40",
      Analyze: Number.NaN,
    } as unknown as Record<string, unknown>);

    assert.equal(result.Recall, 25);
    assert.equal(result.Understand, 0);
    assert.equal(result.Apply, 0);
    assert.equal(result.Analyze, 0);
  });

  it("clamps negative percentages to zero", () => {
    assert.equal(sanitizeBloomDistribution({ Recall: -10 } as never).Recall, 0);
  });
});

describe("toBloomRows", () => {
  it("always yields one renderable row per level", () => {
    const rows = toBloomRows({ Recall: 10 });

    assert.equal(rows.length, BLOOM_LEVELS.length);
    assert.deepEqual(
      rows.map((row) => row.level),
      [...BLOOM_LEVELS]
    );
    assert.equal(rows[0].percentage, 10);
    assert.equal(rows[1].percentage, 0);
  });

  it("never yields a value that breaks toFixed on the reports page", () => {
    for (const row of toBloomRows(undefined)) {
      assert.doesNotThrow(() => row.percentage.toFixed(1));
    }
  });
});