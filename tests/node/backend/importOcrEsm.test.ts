/**
 * The documented OCR import workflow (see
 * `packages/backend/src/scripts/README_OCR_IMPORT.md`):
 *
 *   npm run build --prefix packages/backend
 *   npm run import-ocr:dry-run --prefix packages/backend
 *   npm run import-ocr --prefix packages/backend
 *
 * used to name aliases that did not exist in any package.json, and pointed at
 * `importOcrQuestions.js` / `dryRunOcrImport.js` source files whose database
 * imports could not link under plain Node (`../database/models.js` is absent;
 * `tsc` emits under `dist/`, not beside the source imports).
 *
 * The maintained implementations are the TypeScript sources compiled to
 * `dist/scripts/`. These tests lock in the operational path: the obsolete
 * source-side JS duplicates are gone, the aliases exist and target the
 * compiled entry points, the guide names those entry points, the OCR import
 * graph carries explicit `.js` extensions, and both compiled importers link
 * and reach application logic with plain `node`.
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
const scriptsDir = path.join(backendDir, "src", "scripts");
const databaseDir = path.join(backendDir, "src", "database");
const servicesDir = path.join(backendDir, "src", "services");
const guidePath = path.join(scriptsDir, "README_OCR_IMPORT.md");

const ocrImporterSource = path.join(scriptsDir, "importOcrQuestions.ts");
const ocrDryRunSource = path.join(scriptsDir, "dryRunOcrImport.ts");
const emittedImporter = path.join(
  backendDir,
  "dist",
  "scripts",
  "importOcrQuestions.js",
);
const emittedDryRun = path.join(
  backendDir,
  "dist",
  "scripts",
  "dryRunOcrImport.js",
);

const ALLOWED_RELATIVE_EXTENSION = /\.(js|json|css)$/;

function listTypeScriptFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const files: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const dir = pending.pop() as string;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) pending.push(full);
      else if (entry.name.endsWith(".ts")) files.push(full);
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
    for (const match of source.matchAll(pattern)) found.push(match[1]);
  }
  return found;
}

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
}

describe("OCR importer entry points", () => {
  it("removes the obsolete source-side JS duplicates", () => {
    for (const obsolete of [
      path.join(scriptsDir, "importOcrQuestions.js"),
      path.join(scriptsDir, "dryRunOcrImport.js"),
    ]) {
      assert.ok(
        !fs.existsSync(obsolete),
        `${path.relative(repoRoot, obsolete)} must not exist; the maintained ` +
          "implementation is the .ts source compiled to dist/",
      );
    }
    assert.ok(fs.existsSync(ocrImporterSource), "importOcrQuestions.ts is missing");
    assert.ok(fs.existsSync(ocrDryRunSource), "dryRunOcrImport.ts is missing");
  });

  it("provides import-ocr aliases that target the compiled entry points", () => {
    const backendPkg = readJson(path.join(backendDir, "package.json"));
    const rootPkg = readJson(path.join(repoRoot, "package.json"));
    const backendScripts = (backendPkg.scripts ?? {}) as Record<string, string>;
    const rootScripts = (rootPkg.scripts ?? {}) as Record<string, string>;

    for (const alias of ["import-ocr", "import-ocr:dry-run"]) {
      assert.ok(
        typeof backendScripts[alias] === "string" && backendScripts[alias].length > 0,
        `packages/backend/package.json must define "${alias}"`,
      );
      assert.ok(
        typeof rootScripts[alias] === "string" && rootScripts[alias].length > 0,
        `root package.json must define "${alias}"`,
      );
    }
    assert.match(
      backendScripts["import-ocr"],
      /dist\/scripts\/importOcrQuestions\.js/,
      'backend "import-ocr" must run the compiled dist entry point',
    );
    assert.match(
      backendScripts["import-ocr:dry-run"],
      /dist\/scripts\/dryRunOcrImport\.js/,
      'backend "import-ocr:dry-run" must run the compiled dist entry point',
    );
  });

  it("documents the maintained TypeScript sources and compiled commands", () => {
    const guide = fs.readFileSync(guidePath, "utf8");
    assert.match(guide, /importOcrQuestions\.ts/, "guide must name importOcrQuestions.ts");
    assert.match(guide, /dryRunOcrImport\.ts/, "guide must name dryRunOcrImport.ts");
    assert.match(
      guide,
      /dist\/scripts\/importOcrQuestions\.js/,
      "guide must point at the compiled importOcrQuestions entry point",
    );
    assert.match(
      guide,
      /dist\/scripts\/dryRunOcrImport\.js/,
      "guide must point at the compiled dryRun entry point",
    );
    assert.doesNotMatch(
      guide,
      /`importOcrQuestions\.js`/,
      "guide must not direct operators to the removed source JS importer",
    );
    assert.doesNotMatch(
      guide,
      /`dryRunOcrImport\.js`/,
      "guide must not direct operators to the removed source JS preview",
    );
  });

  it("gives every OCR import-graph relative import an explicit extension", () => {
    const files = [
      ocrImporterSource,
      ocrDryRunSource,
      ...listTypeScriptFiles(databaseDir),
      // Repositories used by the importer reach this service module.
      path.join(servicesDir, "questionBankPage.ts"),
    ];
    assert.ok(files.length > 0, "no OCR import-graph modules found");

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
    "builds and links the documented plain-node commands",
    { timeout: 180_000 },
    () => {
      const npm = process.platform === "win32" ? "npm.cmd" : "npm";
      const build = spawnSync(npm, ["run", "build"], {
        cwd: backendDir,
        encoding: "utf8",
      });
      assert.equal(build.status, 0, `backend build failed:\n${build.stdout}${build.stderr}`);
      for (const emitted of [emittedImporter, emittedDryRun]) {
        assert.ok(
          fs.existsSync(emitted),
          `npm run build must emit ${path.relative(repoRoot, emitted)} so the ` +
            "documented command can run",
        );
      }

      const env = { ...process.env };
      delete env.mongodb_url;
      delete env.MONGODB_URL;

      const dryRun = spawnSync(process.execPath, [emittedDryRun], {
        cwd: backendDir,
        env,
        encoding: "utf8",
        timeout: 60_000,
      });
      const dryOutput = `${dryRun.stdout}${dryRun.stderr}`;
      assert.doesNotMatch(
        dryOutput,
        /ERR_MODULE_NOT_FOUND/,
        `the compiled dry-run failed to resolve its modules:\n${dryOutput}`,
      );
      assert.match(
        dryOutput,
        /Source directory|Directory not found|DRY RUN/,
        `the compiled dry-run never reached its application logic:\n${dryOutput}`,
      );

      const workDir = fs.mkdtempSync(path.join(repoRoot, ".tmp-import-ocr-"));
      try {
        const run = spawnSync(process.execPath, [emittedImporter], {
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
          /MongoDB URI is missing|Source directory|Connected to database/,
          `the compiled importer never reached its application logic:\n${output}`,
        );
      } finally {
        fs.rmSync(workDir, { recursive: true, force: true });
      }
    },
  );
});
