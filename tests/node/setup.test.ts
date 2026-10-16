import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));

// Exercise setup with fake installers: no downloads or changes to real .env files.
function fixture(nodeMajor = 22, npmMajor = 10, pythonOK = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eesa-setup-"));
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(dir, "scripts"));
  fs.copyFileSync(path.join(root, "scripts/setup.sh"), path.join(dir, "scripts/setup.sh"));
  for (const pkg of [".", "packages/backend", "packages/frontend", "packages/ai-pipeline"]) {
    fs.mkdirSync(path.join(dir, pkg), { recursive: true });
    fs.writeFileSync(path.join(dir, pkg, ".env.example"), "SETTING=example\n");
  }
  const script = (name, body) => fs.writeFileSync(path.join(bin, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
  script("node", `if [[ "$1" == --version ]]; then echo v${nodeMajor}.0.0; else exit ${nodeMajor >= 22 ? 0 : 1}; fi`);
  script("npm", `if [[ "$1" == --version ]]; then echo ${npmMajor}.0.0; else echo npm-install >> "$SETUP_LOG"; fi`);
  const python = `
if [[ "$1" == -c ]]; then exit ${pythonOK ? 0 : 1}; fi
if [[ "$1" == --version ]]; then echo Python 3.10.0; exit; fi
if [[ "$2" == venv ]]; then
  mkdir -p "$3/bin"
  cp "$0" "$3/bin/python"
else
  echo pip-install >> "$SETUP_LOG"
fi`;
  script("python3", python);
  script("python", python);
  const run = () => spawnSync("bash", ["scripts/setup.sh"], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, SETUP_LOG: path.join(dir, "calls") },
  });
  return { dir, run, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test("setup installs dependencies and preserves each existing environment on rerun", () => {
  const f = fixture();
  try {
    const env = path.join(f.dir, "packages/frontend/.env");
    fs.writeFileSync(env, "KEEP=my-existing-setting\n");
    for (let i = 0; i < 2; i++) {
      const result = f.run();
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.equal(fs.readFileSync(env, "utf8"), "KEEP=my-existing-setting\n");
      for (const pkg of [".", "packages/backend", "packages/ai-pipeline"]) {
        assert.equal(fs.readFileSync(path.join(f.dir, pkg, ".env"), "utf8"), "SETTING=example\n");
      }
    }
    assert.deepEqual(fs.readFileSync(path.join(f.dir, "calls"), "utf8").trim().split("\n"),
      ["npm-install", "pip-install", "npm-install", "pip-install"]);
  } finally { f.cleanup(); }
});

for (const [name, node, npm, python, message] of [
  ["Node 20", 20, 10, true, /Node >=22 required/],
  ["npm 9", 22, 9, true, /npm >=10 required/],
  ["old Python", 22, 10, false, /Python >=3.10 is required/],
] as const) {
  test(`setup rejects ${name} before installing or writing env files`, () => {
    const f = fixture(node, npm, python);
    try {
      const result = f.run();
      assert.equal(result.status, 1);
      assert.match(result.stderr, message);
      assert.equal(fs.existsSync(path.join(f.dir, "calls")), false);
      assert.equal(fs.existsSync(path.join(f.dir, ".env")), false);
    } finally { f.cleanup(); }
  });
}

test("dev stops the frontend process tree when the AI process exits", () => {
  const f = fixture();
  try {
    fs.copyFileSync(path.join(root, "scripts/dev.mjs"), path.join(f.dir, "scripts/dev.mjs"));
    fs.writeFileSync(path.join(f.dir, "scripts/dev-ai.mjs"), `
      import fs from 'node:fs';
      const timer = setInterval(() => {
        if (fs.existsSync('frontend-ready')) { clearInterval(timer); process.exit(7); }
      }, 10);
    `);
    fs.writeFileSync(path.join(f.dir, "bin/npm"), `#!/bin/bash
      trap 'echo stopped > frontend-stopped; exit 0' TERM
      touch frontend-ready
      while true; do sleep 1; done
    `, { mode: 0o755 });
    const result = spawnSync(process.execPath, ["scripts/dev.mjs"], {
      cwd: f.dir,
      encoding: "utf8",
      env: { ...process.env, PATH: `${f.dir}/bin:${process.env.PATH}` },
      timeout: 5000,
    });
    assert.equal(result.status, 7, result.stdout + result.stderr);
    assert.equal(fs.readFileSync(path.join(f.dir, "frontend-stopped"), "utf8").trim(), "stopped");
  } finally { f.cleanup(); }
});

test("AI launcher explains how to create a missing venv", () => {
  const f = fixture();
  try {
    fs.copyFileSync(path.join(root, "scripts/dev-ai.mjs"), path.join(f.dir, "scripts/dev-ai.mjs"));
    const result = spawnSync(process.execPath, ["scripts/dev-ai.mjs"], { cwd: f.dir, encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /venv is missing.*npm run setup/);
  } finally { f.cleanup(); }
});

test("Node test loader works outside /workspace and preserves JavaScript imports", () => {
  const f = fixture();
  try {
    const hooks = path.join(f.dir, "tests/node");
    fs.mkdirSync(hooks, { recursive: true });
    for (const name of ["register-hook.mjs", "resolve-ts-hooks.mjs"]) {
      fs.copyFileSync(path.join(root, "tests/node", name), path.join(hooks, name));
    }
    fs.writeFileSync(path.join(f.dir, "entry.ts"), 'import { n } from "./sibling.js"; import { delta } from "./helper.js"; export const value: number = n + delta;');
    fs.writeFileSync(path.join(f.dir, "sibling.ts"), 'export const n: number = 40;');
    fs.writeFileSync(path.join(f.dir, "helper.js"), 'export const delta = 2;');
    const result = spawnSync(process.execPath, [
      "--experimental-strip-types", "--import", "./tests/node/register-hook.mjs",
      "--input-type=module", "--eval",
      'import { writeSync } from "node:fs"; const { value } = await import("./entry.ts"); writeSync(1, String(value));',
    ], { cwd: f.dir, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "42");
  } finally { f.cleanup(); }
});
