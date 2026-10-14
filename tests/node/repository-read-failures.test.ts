/**
 * Repository reads must not disguise a database failure as an empty list or a
 * missing record. The behavioral cases live in repository-read-failures.check.ts
 * because the repositories import Mongoose models with type-only names, which
 * the strip-types test runner cannot load. tsx erases those imports.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

const READ_REPOSITORIES = [
  "packages/backend/src/database/repositories/ExamSubmissionRepository.ts",
  "packages/backend/src/database/repositories/UserRepository.ts",
  "packages/backend/src/database/repositories/ExamRepository.ts",
  "packages/backend/src/database/repositories/PromptRepository.ts",
  "packages/backend/src/database/repositories/ExamQuestionRepository.ts",
  "packages/backend/src/database/repositories/ExamAnalysisRepository.ts",
  "packages/backend/src/database/repositories/SubjectRepository.ts",
  "packages/backend/src/database/repositories/JobMetadataRepository.ts",
  "packages/backend/src/database/repositories/UploadSessionRepository.ts",
];

function hiddenReadFailures(source: string): string[] {
  const hits: string[] = [];
  const pattern = /catch\s*\([^)]*\)\s*\{[^}]*return (?:\[\]|null)(?![\w$])/g;
  for (const match of source.matchAll(pattern)) {
    hits.push(match[0].replace(/\s+/g, " ").slice(0, 180));
  }
  return hits;
}

describe("repository reads do not swallow failures as empty data", () => {
  it("has no read catch that returns [] or null", () => {
    const hidden = READ_REPOSITORIES.flatMap((path) =>
      hiddenReadFailures(read(path)).map((hit) => `${path}: ${hit}`),
    );
    assert.deepEqual(hidden, []);
  });

  it("propagates database failures and keeps an empty query empty", () => {
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
      if (key.startsWith("NODE_TEST") || key.startsWith("NODE_CHANNEL")) delete env[key];
    }
    env.mongodb_url = process.env.mongodb_url || "mongodb://127.0.0.1:27017/eesa-read-failure-test";

    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "--test", "tests/node/repository-read-failures.check.ts"],
      { cwd: root, encoding: "utf8", env },
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /propagates a failure while loading a user's submissions/);
    assert.match(result.stdout, /# fail 0/);
  });
});
