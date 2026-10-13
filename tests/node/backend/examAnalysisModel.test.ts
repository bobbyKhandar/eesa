import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

const source = readFileSync(
  new URL("../../../packages/backend/src/services/examAnalysisService.ts", import.meta.url),
  "utf8"
);

/** Gemini 2.0 models shut down on 2026-06-01. Display names are not API ids. */
const RETIRED_OR_INVALID = new Set([
  "Gemini 2.0 Flash-Lite",
  "gemini-2.0-flash",
  "gemini-2.0-flash-001",
  "gemini-2.0-flash-lite",
  "gemini-2.0-flash-lite-001",
]);

function configuredModelId(serviceSource: string): string {
  const match = serviceSource.match(
    /getGenerativeModel\(\{[\s\S]*?model:\s*["']([^"']+)["']/
  );
  assert.ok(match, "exam analysis must pass a model id to getGenerativeModel");
  return match[1];
}

describe("exam analysis Gemini model", () => {
  it("uses the live Flash-Lite API id that replaced the retired Gemini 2.0 Flash-Lite", () => {
    const modelId = configuredModelId(source);
    assert.equal(modelId, "gemini-3.1-flash-lite");
    assert.equal(RETIRED_OR_INVALID.has(modelId), false);
    assert.match(modelId, /^[a-z0-9][a-z0-9._-]*$/);
  });
});
