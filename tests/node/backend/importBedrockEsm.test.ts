/**
 * The documented Bedrock import path (see `BEDROCK_IMPORT_GUIDE.md`):
 *
 *   npm run build
 *   node dist/scripts/importBedrockQuestions.js [directory]
 *
 * used to fail before `main` could reach MongoDB. `packages/backend` is
 * `"type": "module"` and `tsc` emits `ESNext`, but TypeScript's Bundler
 * resolution accepts extensionless relative specifiers and preserves them in
 * the emitted JavaScript. Node's native ESM loader requires an explicit
 * extension, so linking the importer's database modules died with
 * `ERR_MODULE_NOT_FOUND`.
 *
 * These tests lock in both halves of the fix: the emitted database modules
 * carry explicit `.js` extensions, and the compiled importer links and reaches
 * its application logic with plain `node`.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const backendDir = path.join(repoRoot, "packages", "backend");
const databaseDir = path.join(backendDir, "src", "database");
const importerSource = path.join(
  backendDir,
  "src",
  "scripts",
  "importBedrockQuestions.ts",
);
const emittedImporter = path.join(
  backendDir,
  "dist",
  "scripts",
  "importBedrockQuestions.js",
);

const ALLOWED_RELATIVE_EXTENSION = /\.(js|json|css)$/;

function listTypeScriptFiles(root: string): string[] {
  if (!fs.existsSync(root)) {
    return [];
  }
  const files: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const dir = pending.pop() as string;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        pending.push(full);
      } else if (entry.name.endsWith(".ts")) {
        files.push(full);
      }
    }
  }
  return files.sort();
}

/** Relative import/export specifiers that survive into the emitted module. */
function relativeSpecifiers(source: string): string[] {
  const found: string[] = [];
  const patterns = [
    /from\s*['"](\.[^'"]*)['"]/g,
    /import\s*\(\s*['"](\.[^'"]*)['"]\s*\)/g,
    /^\s*import\s+['"](\.[^'"]*)['"]/gm,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      found.push(match[1]);
    }
  }
  return found;
}

describe("Bedrock importer ESM specifiers", () => {
  it("gives every database relative import an explicit extension", () => {
    const files = [
      ...listTypeScriptFiles(databaseDir),
      importerSource,
    ];
    assert.ok(files.length > 0, "no backend database modules found");

    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      for (const specifier of relativeSpecifiers(source)) {
        assert.ok(
          ALLOWED_RELATIVE_EXTENSION.test(specifier),
          `${path.relative(repoRoot, file)} imports "${specifier}" without an explicit ` +
            "extension; Node's native ESM loader will throw ERR_MODULE_NOT_FOUND",
        );
      }
    }
  });

  it(
    "builds and links the documented plain-node command",
    { timeout: 180_000 },
    () => {
      const npm = process.platform === "win32" ? "npm.cmd" : "npm";
      const build = spawnSync(npm, ["run", "build"], {
        cwd: backendDir,
        encoding: "utf8",
      });
      assert.equal(
        build.status,
        0,
        `backend build failed:\n${build.stdout}${build.stderr}`,
      );
      assert.ok(
        fs.existsSync(emittedImporter),
        "npm run build must emit dist/scripts/importBedrockQuestions.js so the " +
          "documented command can run",
      );

      const workDir = fs.mkdtempSync(path.join(repoRoot, ".tmp-import-bedrock-"));
      const env = { ...process.env };
      delete env.mongodb_url;
      try {
        const run = spawnSync(process.execPath, [emittedImporter, workDir], {
          cwd: workDir,
          env,
          encoding: "utf8",
          timeout: 60_000,
        });
        const output = `${run.stdout}${run.stderr}`;
        assert.doesNotMatch(
          output,
          /ERR_MODULE_NOT_FOUND/,
          `the compiled importer failed to resolve its modules:\n${output}`,
        );
        assert.match(
          output,
          /mongodb_url not found/,
          `the compiled importer never reached its application logic:\n${output}`,
        );
      } finally {
        fs.rmSync(workDir, { recursive: true, force: true });
      }
    },
  );
});
