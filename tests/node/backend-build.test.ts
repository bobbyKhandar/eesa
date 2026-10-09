import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("the backend compiles all modules used by the development watcher", () => {
  const result = spawnSync(process.execPath, [
    "node_modules/typescript/bin/tsc", "--project", "packages/backend/tsconfig.json", "--noEmit",
  ], { cwd: new URL("../../", import.meta.url), encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
