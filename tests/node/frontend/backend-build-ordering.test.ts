/**
 * Production builds and the dev server import `@/backend/dist/...`, and git
 * does not track that output. `next build` used to run without compiling the
 * backend first, so a clean checkout could not resolve the API route imports,
 * and `next dev` had no barrier at all.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ensureBackendBuild,
  needsBackendBuild,
} from "../../../scripts/ensure-backend-build.mjs";

const root = joinRepoRoot(import.meta.url);
const backendDir = path.join(root, "packages", "backend");
const gateScript = "scripts/ensure-backend-build.mjs";

function joinRepoRoot(metaUrl) {
  return path.resolve(path.dirname(fileURLToPath(metaUrl)), "../../..");
}

const read = (relative) =>
  JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));

/** A backend tree shaped like the real one, with and without output. */
function makeFixture({ sources, excludes = [], dist = true }) {
  const backend = fs.mkdtempSync(path.join(os.tmpdir(), "eesa-backend-"));
  const srcRoot = path.join(backend, "src");
  fs.mkdirSync(srcRoot, { recursive: true });
  for (const [relative, body] of Object.entries(sources)) {
    const file = path.join(srcRoot, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  }
  const distRoot = path.join(backend, "dist");
  if (dist) {
    for (const relative of Object.keys(sources)) {
      const emitted = path.join(distRoot, relative.replace(/\.[^.]+$/, ".js"));
      fs.mkdirSync(path.dirname(emitted), { recursive: true });
      fs.writeFileSync(emitted, "");
    }
  }
  return { backend, srcRoot, distRoot, excludes };
}

describe("backend build ordering", () => {
  it("leaves the root without a build script so Vercel runs the frontend build", () => {
    // Vercel builds this repo from the root and runs the root `build` script
    // whenever one exists, in place of its own Next.js build. A root script
    // that only delegates to packages/frontend breaks every deployment (#209).
    // The backend is still compiled first through the frontend `prebuild`.
    const scripts = read("package.json").scripts;
    assert.equal(scripts.build, undefined);
  });

  it("starts the frontend dev server from the root", () => {
    const dev = read("package.json").scripts.dev;
    assert.equal(dev, "npm run dev --prefix packages/frontend");
  });

  it("gates the frontend production build on the backend compile", () => {
    const pkg = read("packages/frontend/package.json");
    assert.equal(pkg.scripts.build, "next build");
    assert.equal(
      typeof pkg.scripts.prebuild,
      "string",
      "the frontend build needs a prebuild step",
    );
    assert.match(
      pkg.scripts.prebuild,
      new RegExp(gateScript.replace(".", "\\.")),
    );
  });

  it("gates the frontend dev server on the backend compile", () => {
    const pkg = read("packages/frontend/package.json");
    assert.equal(pkg.scripts.dev, "next dev");
    assert.equal(
      typeof pkg.scripts.predev,
      "string",
      "dev must not start before the backend is compiled",
    );
    assert.match(
      pkg.scripts.predev,
      new RegExp(gateScript.replace(".", "\\.")),
    );
  });

  it("points both gates at an existing script", () => {
    assert.ok(
      fs.existsSync(path.join(root, gateScript)),
      `${gateScript} is missing`,
    );
  });

  it("ignores sources the backend tsconfig excludes from the compile", () => {
    const tsconfig = JSON.parse(
      fs.readFileSync(path.join(backendDir, "tsconfig.json"), "utf8"),
    );
    const { srcRoot, distRoot } = makeFixture({
      sources: { "index.ts": "export const ok = true;\n" },
    });
    try {
      const decision = needsBackendBuild({
        srcRoot,
        distRoot,
        excludes: tsconfig.exclude,
      });
      assert.equal(decision.build, false, decision.reason);
    } finally {
      fs.rmSync(path.dirname(srcRoot), { recursive: true, force: true });
    }
  });
});

describe("needsBackendBuild", () => {
  it("compiles when dist does not exist yet", () => {
    const { srcRoot, distRoot } = makeFixture({
      sources: { "index.ts": "" },
      dist: false,
    });
    try {
      const decision = needsBackendBuild({ srcRoot, distRoot });
      assert.equal(decision.build, true);
      assert.match(decision.reason, /missing/);
    } finally {
      fs.rmSync(path.dirname(srcRoot), { recursive: true, force: true });
    }
  });

  it("compiles when an output file was removed", () => {
    const { srcRoot, distRoot } = makeFixture({
      sources: { "index.ts": "", "repositories/index.ts": "" },
    });
    try {
      fs.rmSync(path.join(distRoot, "repositories/index.js"));
      const decision = needsBackendBuild({ srcRoot, distRoot });
      assert.equal(decision.build, true);
      assert.match(decision.reason, /repositories\/index\.ts/);
    } finally {
      fs.rmSync(path.dirname(srcRoot), { recursive: true, force: true });
    }
  });

  it("compiles when a source file is newer than the output", () => {
    const { srcRoot, distRoot } = makeFixture({ sources: { "index.ts": "" } });
    try {
      const soon = new Date(Date.now() + 5000);
      fs.utimesSync(path.join(srcRoot, "index.ts"), soon, soon);
      const decision = needsBackendBuild({ srcRoot, distRoot });
      assert.equal(decision.build, true);
      assert.match(decision.reason, /changed/);
    } finally {
      fs.rmSync(path.dirname(srcRoot), { recursive: true, force: true });
    }
  });

  it("skips the compile when the output is complete and newer", () => {
    const { srcRoot, distRoot } = makeFixture({
      sources: { "index.ts": "", "repositories/index.ts": "" },
    });
    try {
      const decision = needsBackendBuild({ srcRoot, distRoot });
      assert.equal(decision.build, false, decision.reason);
      assert.equal(decision.modules, 2);
    } finally {
      fs.rmSync(path.dirname(srcRoot), { recursive: true, force: true });
    }
  });

  it("does not require output for excluded sources", () => {
    const { srcRoot, distRoot } = makeFixture({
      sources: {
        "index.ts": "",
        "scripts/seed.ts": "",
        "services/examOcrService.ts": "",
      },
      excludes: ["src/scripts", "src/services/examOcrService.ts"],
    });
    try {
      fs.rmSync(path.join(distRoot, "scripts"), { recursive: true });
      fs.rmSync(path.join(distRoot, "services"), { recursive: true });
      const decision = needsBackendBuild({
        srcRoot,
        distRoot,
        excludes: ["src/scripts", "src/services/examOcrService.ts"],
      });
      assert.equal(decision.build, false, decision.reason);
      assert.equal(decision.modules, 1);
    } finally {
      fs.rmSync(path.dirname(srcRoot), { recursive: true, force: true });
    }
  });
});

describe("ensureBackendBuild", () => {
  const copyBackend = () => {
    const backendRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "eesa-backend-copy-"),
    );
    const copied = ["dist", "node_modules"];
    fs.cpSync(backendDir, backendRoot, {
      recursive: true,
      filter: (source) => !copied.includes(path.basename(source)),
    });
    fs.symlinkSync(
      path.join(root, "node_modules"),
      path.join(backendRoot, "node_modules"),
    );
    return backendRoot;
  };

  it("compiles a backend that has no output and then reports it as current", () => {
    const backendRoot = copyBackend();
    const log = [];
    try {
      const compiled = ensureBackendBuild({
        backendRoot,
        log: (line) => log.push(line),
      });
      assert.equal(compiled.build, true);
      assert.equal(compiled.compiled, true);
      assert.equal(compiled.failed, false);
      assert.ok(
        fs.existsSync(
          path.join(
            backendRoot,
            "dist/database/repositories/ExamRepository.js",
          ),
        ),
        "the compile must emit the modules the API routes import",
      );

      const skipped = ensureBackendBuild({
        backendRoot,
        log: (line) => log.push(line),
      });
      assert.equal(skipped.build, false);
      assert.equal(skipped.compiled, false);
      assert.match(log.at(-1), /up to date/);
    } finally {
      fs.rmSync(backendRoot, { recursive: true, force: true });
    }
  });

  it("reports a failed compile instead of letting the caller continue", () => {
    const backendRoot = copyBackend();
    try {
      const failed = ensureBackendBuild({
        backendRoot,
        build: () => false,
        log: () => {},
      });
      assert.equal(failed.compiled, true);
      assert.equal(failed.failed, true);
    } finally {
      fs.rmSync(backendRoot, { recursive: true, force: true });
    }
  });
});

describe("backend build gate script", () => {
  it("exits successfully when run against this checkout", () => {
    const script = path.join(root, gateScript);
    const result = spawnSync(process.execPath, [script], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.match(`${result.stdout}${result.stderr}`, /backend/);
  });
});
