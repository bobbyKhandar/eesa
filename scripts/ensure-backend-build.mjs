/**
 * Compile the backend before anything that imports its generated modules.
 *
 * Frontend API routes import `@/backend/dist/...`, and `dist/` is not tracked
 * in git, so a clean checkout has no backend output: `next build` fails to
 * resolve those imports and `next dev` fails the first time a route is
 * compiled. `npm run build` and `npm run dev` both run this script first.
 * The compile is skipped when `dist/` already mirrors `src/` and is newer.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const defaultBackendRoot = path.join(repoRoot, "packages", "backend");
const COMPILED_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function collectFiles(rootDir, predicate) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }
  const files = [];
  const pending = [rootDir];
  while (pending.length > 0) {
    const dir = pending.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        pending.push(full);
      } else if (predicate(full)) {
        files.push(full);
      }
    }
  }
  return files;
}

function newestMtime(files) {
  return files.reduce(
    (newest, file) => Math.max(newest, fs.statSync(file).mtimeMs),
    0,
  );
}

/**
 * `excludes` entries are backend-root relative (`src/database/scripts`),
 * the same way `tsconfig.json` writes them.
 */
export function isExcludedSource(backendRelative, excludes) {
  return (excludes ?? []).some((entry) => {
    const normalized = toPosix(entry).replace(/^\.\//, "");
    return (
      backendRelative === normalized ||
      backendRelative.startsWith(`${normalized}/`)
    );
  });
}

/**
 * Decide whether the backend has to be compiled for `dist/` to be usable:
 * the output must exist, must cover every compiled source file, and must be
 * newer than the newest source file.
 */
export function needsBackendBuild({ srcRoot, distRoot, excludes = [] }) {
  const sources = collectFiles(srcRoot, (file) =>
    COMPILED_EXTENSIONS.has(path.extname(file)),
  )
    .map((file) => {
      const srcRelative = toPosix(path.relative(srcRoot, file));
      return { backendRelative: `src/${srcRelative}`, srcRelative };
    })
    .filter(
      ({ backendRelative }) => !isExcludedSource(backendRelative, excludes),
    )
    .sort((left, right) =>
      left.backendRelative.localeCompare(right.backendRelative),
    );

  if (sources.length === 0) {
    return {
      build: true,
      reason: `no compiled sources found in ${toPosix(srcRoot)}`,
      modules: 0,
    };
  }

  if (!fs.existsSync(distRoot)) {
    return {
      build: true,
      reason: "dist is missing (no compiled output yet)",
      modules: sources.length,
    };
  }

  const missing = sources.find(({ backendRelative, srcRelative }) => {
    return !fs.existsSync(
      path.join(distRoot, srcRelative.replace(/\.[^.]+$/, ".js")),
    );
  });
  if (missing) {
    return {
      build: true,
      reason: `dist has no output for ${missing.backendRelative}`,
      modules: sources.length,
    };
  }

  const compiled = collectFiles(distRoot, () => true);
  const sourceFiles = sources.map(({ srcRelative }) =>
    path.join(srcRoot, srcRelative),
  );
  if (newestMtime(sourceFiles) > newestMtime(compiled)) {
    return {
      build: true,
      reason: "a source file changed after the last compile",
      modules: sources.length,
    };
  }

  return {
    build: false,
    reason: "dist is up to date",
    modules: sources.length,
  };
}

export function readBackendTsconfig(backendRoot = defaultBackendRoot) {
  const tsconfigPath = path.join(backendRoot, "tsconfig.json");
  const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, "utf8"));
  return { exclude: tsconfig.exclude ?? [] };
}

/** Run the backend compile. Returns false when `npm run build` fails. */
export function runBackendBuild(
  backendRoot,
  { cwd = backendRoot, spawn = spawnSync } = {},
) {
  const result = spawn("npm", ["run", "build", "--prefix", backendRoot], {
    cwd,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  return result.status === 0;
}

/**
 * Compile the backend when `dist/` is missing, incomplete, or stale.
 * Returns the decision plus whether the compile ran and succeeded.
 */
export function ensureBackendBuild({
  backendRoot = defaultBackendRoot,
  srcRoot = path.join(backendRoot, "src"),
  distRoot = path.join(backendRoot, "dist"),
  excludes,
  log = console.log,
  build = runBackendBuild,
} = {}) {
  const decision = needsBackendBuild({
    srcRoot,
    distRoot,
    excludes: excludes ?? readBackendTsconfig(backendRoot).exclude,
  });

  if (!decision.build) {
    log(
      `[backend] ${decision.reason}, nothing to compile (${decision.modules} modules)`,
    );
    return { ...decision, compiled: false, failed: false };
  }

  log(
    `[backend] ${decision.reason}; compiling ${toPosix(path.relative(repoRoot, backendRoot))}`,
  );
  const succeeded = build(backendRoot);
  if (!succeeded) {
    log("[backend] npm run build failed");
  }
  return { ...decision, compiled: true, failed: !succeeded };
}

export function main({ runner = ensureBackendBuild } = {}) {
  try {
    const result = runner({});
    return result.failed ? 1 : 0;
  } catch (error) {
    console.error(
      `[backend] ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exit(main());
}
