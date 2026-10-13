/**
 * Production builds must fail when the frontend has new TypeScript or ESLint
 * errors. `next.config.mjs` used to set both ignore flags, so `next build`
 * could not catch those regressions.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("frontend build checks", () => {
  it("does not ignore TypeScript or ESLint failures during next build", () => {
    const config = read("packages/frontend/next.config.mjs");
    assert.match(config, /ignoreDuringBuilds:\s*false/);
    assert.match(config, /ignoreBuildErrors:\s*false/);
    assert.doesNotMatch(config, /ignoreDuringBuilds:\s*true/);
    assert.doesNotMatch(config, /ignoreBuildErrors:\s*true/);
  });

  it("exposes typecheck and lint scripts and the frontend tsconfig", () => {
    const pkg = JSON.parse(read("packages/frontend/package.json"));
    assert.equal(typeof pkg.scripts.typecheck, "string");
    assert.match(pkg.scripts.typecheck, /tsc --noEmit/);
    assert.equal(pkg.scripts.lint, "next lint");

    const tsconfig = JSON.parse(read("packages/frontend/tsconfig.json"));
    assert.equal(tsconfig.compilerOptions.noEmit, true);
    assert.deepEqual(tsconfig.compilerOptions.paths["@/*"], [".././*"]);
  });
});
