/**
 * Schema Migration Script
 *
 * The implementation lives in migrate-schema.ts so the ExamQuestion mapping
 * cannot drift from the TypeScript entry point. This file remains the
 * `node migrate-schema.js` command documented for operators.
 *
 * Usage:
 *   node migrate-schema.js [--dry-run] [--batch-size=100]
 */

import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const script = fileURLToPath(new URL("./migrate-schema.ts", import.meta.url));

let tsx;
try {
  tsx = require.resolve("tsx");
} catch {
  console.error("tsx is required to run migrate-schema.js. From the repo root: npx tsx packages/backend/src/database/scripts/migrate-schema.ts");
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--import", tsx, script, ...process.argv.slice(2)], {
  stdio: "inherit",
});

process.exit(result.status === null ? 1 : result.status);
