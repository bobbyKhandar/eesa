import { spawnSync } from "node:child_process";
import { strict as assert } from "node:assert";
import { fileURLToPath } from "node:url";
import path from "node:path";

/** Runs the DOCX extractor suite. Both Node test scripts call this. */
export function runDocxHandlerTests(): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const pipelineDir = path.resolve(here, "../../packages/ai-pipeline");
  const result = spawnSync("python3", ["-m", "unittest", "tests.test_docx_handler"], {
    cwd: pipelineDir,
    encoding: "utf8",
  });
  assert.equal(
    result.status,
    0,
    `DOCX extraction tests failed\n${result.stdout ?? ""}\n${result.stderr ?? ""}`
  );
}
