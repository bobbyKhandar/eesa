/**
 * Issue #94: orphan OCR watcher code and the ESM deployment check.
 *
 * The backend shipped three orphaned OCR scripts:
 * - `src/services/generateBloomsAnatomy.ts`: entirely commented out, no
 *   application references.
 * - `src/services/test.js`: unreferenced duplicate of the old Bloom's
 *   watcher that started watching a hard-coded Windows path at module load.
 * - `src/services/testEC2Deployment.ts`: unreferenced EC2 OCR diagnostic
 *   using the CommonJS `require.main === module` guard even though the
 *   backend package is `"type": "module"` (`require` is not defined under
 *   the intended TypeScript runner).
 *
 * These tests lock in the fix: the dead files are gone, the EC2 deployment
 * diagnostic lives under `src/scripts/` with an ESM-compatible entrypoint
 * and no import-time side effects, and no source references the removed
 * modules.
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
const servicesDir = path.join(backendDir, "src", "services");
const scriptsDir = path.join(backendDir, "src", "scripts");

const diagnosticSource = path.join(scriptsDir, "testEC2Deployment.ts");

function listSourceFiles(root: string, extensions: string[]): string[] {
  if (!fs.existsSync(root)) return [];
  const files: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const dir = pending.pop() as string;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== "dist") {
          pending.push(full);
        }
      } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
        files.push(full);
      }
    }
  }
  return files.sort();
}

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
}

describe("orphan OCR watcher cleanup (#94)", () => {
  it("removes the dead/commented OCR watcher files", () => {
    for (const removed of [
      path.join(servicesDir, "generateBloomsAnatomy.ts"),
      path.join(servicesDir, "test.js"),
    ]) {
      assert.ok(
        !fs.existsSync(removed),
        `${path.relative(repoRoot, removed)} must not exist; it is dead ` +
          "orphan OCR watcher code with no application references",
      );
    }
  });

  it("keeps the EC2 deployment diagnostic under src/scripts, not src/services", () => {
    assert.ok(
      !fs.existsSync(path.join(servicesDir, "testEC2Deployment.ts")),
      "src/services/testEC2Deployment.ts must be moved to src/scripts/",
    );
    assert.ok(
      fs.existsSync(diagnosticSource),
      "src/scripts/testEC2Deployment.ts is missing",
    );
    const source = fs.readFileSync(diagnosticSource, "utf8");
    assert.match(
      source,
      /export\s+(async\s+)?function\s+testEC2Deployment|export\s*\{\s*testEC2Deployment/,
      "the diagnostic must still export testEC2Deployment",
    );
  });

  it("uses an ESM-compatible entrypoint (no require.main)", () => {
    const source = fs.readFileSync(diagnosticSource, "utf8");
    assert.doesNotMatch(
      source,
      /require\.main/,
      "the backend is ESM (\"type\": \"module\"); require.main is not defined",
    );
    assert.doesNotMatch(
      source,
      /(^|[^.\w])require\s*\(/,
      "bare require() calls are not available in ESM modules",
    );
    assert.match(
      source,
      /import\.meta\.url/,
      "the entrypoint guard must use import.meta.url under ESM",
    );
    assert.match(
      source,
      /process\.argv\[1\]/,
      "the entrypoint guard must detect direct execution via process.argv",
    );
  });

  it("has no import-time side effects", () => {
    const source = fs.readFileSync(diagnosticSource, "utf8");
    for (const forbidden of ["chokidar", ".watch(", "C:/", "C:\\"]) {
      assert.ok(
        !source.includes(forbidden),
        `the diagnostic must not contain ${JSON.stringify(forbidden)} ` +
          "(no watcher, no hard-coded paths at module load)",
      );
    }
    // The only call of the diagnostic must sit inside the guarded
    // direct-execution block.
    const lines = source.split("\n");
    const guardIndex = lines.findIndex((line) =>
      /if\s*\(\s*isMain\s*\)/.test(line),
    );
    assert.notEqual(
      guardIndex,
      -1,
      "the diagnostic must guard execution behind an isMain check",
    );
    lines.forEach((line, index) => {
      if (/testEC2Deployment\s*\(\s*\)/.test(line) && !/async\s+function/.test(line)) {
        assert.ok(
          index > guardIndex,
          `testEC2Deployment() is invoked at ${diagnosticSource}:${index + 1} ` +
            "outside the guarded entrypoint block",
        );
      }
    });
  });

  it("imports the EC2 client with an explicit ESM-resolvable specifier", () => {
    const source = fs.readFileSync(diagnosticSource, "utf8");
    assert.match(
      source,
      /from\s*['"]\.\.\/services\/ec2OcrClient\.js['"]/,
      "the moved diagnostic must import ../services/ec2OcrClient.js with " +
        "an explicit extension (Node native ESM requires it)",
    );
    assert.ok(
      fs.existsSync(path.join(servicesDir, "ec2OcrClient.ts")),
      "the diagnostic's import target src/services/ec2OcrClient.ts is missing",
    );
  });

  it("leaves no source references to the removed orphan modules", () => {
    const roots = [
      path.join(backendDir, "src"),
      path.join(repoRoot, "packages", "frontend"),
      path.join(repoRoot, "packages", "ai-pipeline"),
    ];
    const files = roots.flatMap((root) =>
      listSourceFiles(root, [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]),
    );
    assert.ok(files.length > 0, "no source files found to scan");
    for (const file of files) {
      if (file === diagnosticSource) continue;
      const source = fs.readFileSync(file, "utf8");
      assert.doesNotMatch(
        source,
        /generateBloomsAnatomy/,
        `${path.relative(repoRoot, file)} still references the removed orphan module`,
      );
      assert.doesNotMatch(
        source,
        /require\.main\s*===\s*module/,
        `${path.relative(repoRoot, file)} still uses the CommonJS entrypoint guard`,
      );
    }
    // The hard-coded Windows watcher path from the old duplicate must be gone.
    for (const file of listSourceFiles(path.join(backendDir, "src"), [".ts", ".js"])) {
      const source = fs.readFileSync(file, "utf8");
      assert.doesNotMatch(
        source,
        /C:\/ocr_output/,
        `${path.relative(repoRoot, file)} still watches the orphan hard-coded path`,
      );
    }
  });

  it("wires the diagnostic alias and keeps the ESM/Vercel constraints", () => {
    const backendPkg = readJson(path.join(backendDir, "package.json"));
    const rootPkg = readJson(path.join(repoRoot, "package.json"));
    assert.equal(
      backendPkg.type,
      "module",
      'packages/backend/package.json must stay "type": "module"',
    );
    const backendScripts = (backendPkg.scripts ?? {}) as Record<string, string>;
    assert.match(
      backendScripts["test:ec2-deployment"] ?? "",
      /src\/scripts\/testEC2Deployment\.ts/,
      'backend "test:ec2-deployment" must run src/scripts/testEC2Deployment.ts',
    );
    const rootScripts = (rootPkg.scripts ?? {}) as Record<string, unknown>;
    assert.ok(
      !("build" in rootScripts),
      'root package.json must not define a "build" script ' +
        "(Vercel runs it instead of the Next.js build)",
    );
  });

  it(
    "runs the diagnostic under tsx without a require error",
    { timeout: 90_000 },
    () => {
      // Point at a closed loopback port so the health check fails fast and
      // gracefully instead of touching any real deployment.
      const env = { ...process.env, EC2_OCR_URL: "http://127.0.0.1:9" };
      const run = spawnSync(
        process.execPath,
        ["--import", "tsx", diagnosticSource],
        { cwd: backendDir, env, encoding: "utf8", timeout: 60_000 },
      );
      const output = `${run.stdout}${run.stderr}`;
      assert.doesNotMatch(
        output,
        /require is not defined|ReferenceError|ERR_MODULE_NOT_FOUND/,
        `the ESM deployment check failed to load:\n${output}`,
      );
      assert.match(
        output,
        /Testing EC2 OCR Deployment/,
        `the diagnostic never reached its application logic:\n${output}`,
      );
      assert.equal(
        run.status,
        0,
        `the diagnostic exited with status ${run.status}:\n${output}`,
      );
    },
  );
});
