/**
 * /analyze-report was a demo page that rendered a hard-coded Physics analysis.
 * A visit must enter the real analysis flow and must not present sample rows,
 * coverage claims, or chart values as the user's report.
 */
import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

const DEMO_PAGE = "packages/frontend/app/analyze-report/page.tsx";
const REAL_PAGE = "packages/frontend/app/analysis-report/[id]/page.tsx";
const NEXT_CONFIG = "packages/frontend/next.config.mjs";

const FABRICATED_MARKERS = [
  "Physics — Mechanics",
  "82% of questions align with the selected syllabus outline",
  "State Newton's three laws of motion",
  "Deviation within ±5% across cognitive levels",
];

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("/analyze-report does not show a fabricated analysis", () => {
  it("does not keep a page of sample chart, coverage, or question data", () => {
    if (!existsSync(DEMO_PAGE)) return;

    const source = read(DEMO_PAGE);
    for (const marker of FABRICATED_MARKERS) {
      assert.equal(
        source.includes(marker),
        false,
        `obsolete route still contains fabricated sample text: ${marker}`,
      );
    }
  });

  it("redirects /analyze-report to the real upload-and-analyze flow", () => {
    const config = read(NEXT_CONFIG);
    assert.match(config, /source:\s*["']\/analyze-report["']/);
    assert.match(config, /destination:\s*["']\/ai-analyze["']/);
  });

  it("leaves persisted reports on /analysis-report/[id]", () => {
    const source = read(REAL_PAGE);
    assert.match(source, /\/api\/exam-analysis\/\$\{id\}/);
    assert.match(source, /function handleDelete/);
    assert.match(source, /function handlePublish/);
    assert.equal(source.includes("Physics — Mechanics"), false);
  });
});
