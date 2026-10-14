/**
 * Deleting a backup must only report success when S3 removed every key.
 *
 * S3 accepts a DeleteObjects request as a whole and reports the keys it could
 * not remove in the response's `Errors` array. Counting the requested keys as
 * deleted regardless told the administrator the backup was gone while its
 * objects stayed in the bucket, and the UI dropped the row that showed them.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, it } from "node:test";

import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";

import {
  BACKUP_DELETE_BATCH_SIZE,
  isRetryableBackupDeleteError,
  summarizeBackupDeletes,
  type BackupDeleteResponseError,
} from "../../packages/backend/src/services/backupPlan.ts";
import {
  BackupNotFoundError,
  deleteBackup,
} from "../../packages/backend/src/services/databaseBackupService.ts";

const BACKUP_ID = "backup_2026-10-14T10-00-00-000Z";
const PREFIX = `database-backups/${BACKUP_ID}/`;

function backupKey(name: string): string {
  return `${PREFIX}${name}`;
}

function objectError(
  key: string,
  code: string,
  message = `${code} from S3`
): BackupDeleteResponseError {
  return { Key: key, Code: code, Message: message };
}

function readRepoFile(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

describe("summarizeBackupDeletes", () => {
  it("reports every requested key as deleted when no response has errors", () => {
    const outcome = summarizeBackupDeletes(
      [backupKey("data.json"), backupKey("metadata.json")],
      [{}, { Errors: [] }]
    );

    assert.equal(outcome.success, true);
    assert.equal(outcome.deletedObjects, 2);
    assert.equal(outcome.failedObjects, 0);
    assert.deepEqual(outcome.failedKeys, []);
    assert.deepEqual(outcome.errors, []);
    assert.match(outcome.message, /Deleted 2 of 2 objects/);
  });

  it("counts only the keys S3 removed when a response reports a failure", () => {
    const failing = backupKey("data.json");

    const outcome = summarizeBackupDeletes(
      [failing, backupKey("metadata.json"), backupKey("part.txt")],
      [{ Errors: [objectError(failing, "InternalError")] }]
    );

    assert.equal(outcome.success, false);
    assert.equal(outcome.deletedObjects, 2);
    assert.equal(outcome.failedObjects, 1);
    assert.deepEqual(outcome.failedKeys, [failing]);
    assert.deepEqual(outcome.errors, [
      {
        key: failing,
        code: "InternalError",
        message: "InternalError from S3",
        retryable: true,
      },
    ]);
    assert.match(outcome.message, /Deleted 2 of 3 objects, 1 could not be deleted/);
    assert.ok(outcome.message.includes(failing), "the message must name the failed key");
    assert.match(outcome.message, /still stored/);
    assert.match(outcome.message, /retried/);
  });

  it("collects the failures of every batch, not just the last response", () => {
    const first = backupKey("data.json");
    const second = backupKey("part-2.txt");

    const outcome = summarizeBackupDeletes(
      [first, backupKey("metadata.json"), second],
      [
        { Errors: [objectError(first, "AccessDenied")] },
        { Errors: [objectError(second, "InternalError", "Please try again")] },
      ]
    );

    assert.equal(outcome.success, false);
    assert.equal(outcome.deletedObjects, 1);
    assert.equal(outcome.failedObjects, 2);
    assert.deepEqual(outcome.failedKeys, [first, second]);
    assert.deepEqual(
      outcome.errors.map((error) => error.code),
      ["AccessDenied", "InternalError"]
    );
    assert.match(outcome.message, /1 of 2 failures are transient \(InternalError\)/);
  });

  it("reports a backup that S3 removed nothing from as a failure", () => {
    const keys = [backupKey("data.json"), backupKey("metadata.json")];

    const outcome = summarizeBackupDeletes(keys, [
      { Errors: keys.map((key) => objectError(key, "AccessDenied")) },
    ]);

    assert.equal(outcome.success, false);
    assert.equal(outcome.deletedObjects, 0);
    assert.equal(outcome.failedObjects, 2);
    assert.deepEqual(outcome.failedKeys, keys);
    assert.doesNotMatch(outcome.message, /transient/);
  });

  it("ignores duplicate and unknown keys reported by S3", () => {
    const known = backupKey("data.json");

    const outcome = summarizeBackupDeletes([known], [
      {
        Errors: [
          objectError(known, "InternalError", "first report"),
          objectError(known, "AccessDenied", "second report"),
          objectKeyLessError(),
          objectError(backupKey("not-requested.txt"), "AccessDenied"),
        ],
      },
    ]);

    assert.deepEqual(outcome.failedKeys, [known]);
    assert.equal(outcome.errors.length, 1);
    assert.equal(outcome.errors[0].message, "first report");
  });

  it("falls back to a generic code and message when S3 omits them", () => {
    const failing = backupKey("metadata.json");

    const outcome = summarizeBackupDeletes([failing], [{ Errors: [{ Key: failing }] }]);

    assert.equal(outcome.success, false);
    assert.equal(outcome.errors[0].code, "UnknownError");
    assert.match(outcome.errors[0].message, /no reason/);
    assert.equal(outcome.errors[0].retryable, false);
  });

  it("treats an empty key list as a completed delete", () => {
    const outcome = summarizeBackupDeletes([], []);
    assert.equal(outcome.success, true);
    assert.equal(outcome.deletedObjects, 0);
  });
});

function objectKeyLessError(): BackupDeleteResponseError {
  return { Code: "AccessDenied", Message: "no key reported" };
}

describe("isRetryableBackupDeleteError", () => {
  for (const code of [
    "InternalError",
    "RequestTimeout",
    "RequestTimeTooSkewed",
    "ServiceUnavailable",
    "SlowDown",
    "ThrottlingException",
  ]) {
    it(`treats ${code} as retryable`, () => {
      assert.equal(isRetryableBackupDeleteError({ Code: code }), true);
    });
  }

  for (const code of ["AccessDenied", "InvalidArgument", "BucketNotEmpty", "NoSuchKey", ""]) {
    it(`does not treat ${code || "an empty code"} as retryable`, () => {
      assert.equal(isRetryableBackupDeleteError({ Code: code }), false);
    });
  }

  it("does not treat a missing error as retryable", () => {
    assert.equal(isRetryableBackupDeleteError(undefined), false);
    assert.equal(isRetryableBackupDeleteError(null), false);
    assert.equal(isRetryableBackupDeleteError({}), false);
  });
});

describe("deleteBackup", () => {
  const originalSend = S3Client.prototype.send;

  interface S3Stub {
    contents: string[];
    deleteResponses: Array<Record<string, unknown> | Error>;
    deleteCalls: Array<string[]>;
  }

  let stub: S3Stub;

  function setBackupContents(names: string[]): void {
    stub.contents = names.map((name) => backupKey(name));
  }

  beforeEach(() => {
    stub = { contents: [], deleteResponses: [], deleteCalls: [] };
    S3Client.prototype.send = (async function send(command: any) {
      if (command instanceof ListObjectsV2Command) {
        return {
          Contents: stub.contents.map((Key) => ({ Key, Size: 1 })),
          IsTruncated: false,
        };
      }
      if (command instanceof DeleteObjectsCommand) {
        const keys = (command.input.Delete?.Objects ?? [])
          .map((object: { Key?: string }) => object.Key)
          .filter((key: unknown): key is string => typeof key === "string" && key.length > 0);
        stub.deleteCalls.push(keys);
        const next = stub.deleteResponses.shift();
        if (next instanceof Error) throw next;
        return next ?? {};
      }
      throw new Error(`Unexpected S3 command: ${command.constructor.name}`);
    }) as any;
  });

  afterEach(() => {
    S3Client.prototype.send = originalSend;
  });

  it("reports success once every key is deleted", async () => {
    setBackupContents(["data.json", "metadata.json"]);
    stub.deleteResponses = [{ Deleted: [] }, {}];

    const outcome = await deleteBackup(BACKUP_ID);

    assert.equal(outcome.success, true);
    assert.equal(outcome.deletedObjects, 2);
    assert.equal(outcome.failedKeys.length, 0);
    assert.equal(stub.deleteCalls.length, 1);
    assert.deepEqual(stub.deleteCalls[0], [backupKey("data.json"), backupKey("metadata.json")]);
  });

  it("does not report success when S3 refuses a key of an accepted request", async () => {
    setBackupContents(["data.json", "metadata.json", "part.txt"]);
    stub.deleteResponses = [{ Errors: [objectError(backupKey("metadata.json"), "InternalError")] }];

    const outcome = await deleteBackup(BACKUP_ID);

    assert.equal(outcome.success, false);
    assert.equal(outcome.deletedObjects, 2);
    assert.equal(outcome.failedObjects, 1);
    assert.deepEqual(outcome.failedKeys, [backupKey("metadata.json")]);
    assert.equal(outcome.errors[0].retryable, true);
    assert.equal(stub.deleteCalls.length, 1);
  });

  it("batches keys larger than the DeleteObjects limit and keeps every response", async () => {
    setBackupContents(
      Array.from({ length: BACKUP_DELETE_BATCH_SIZE + 2 }, (_, index) => `part-${index}.txt`)
    );
    stub.deleteResponses = [{}, { Errors: [objectError(backupKey("part-1000.txt"), "AccessDenied")] }];

    const outcome = await deleteBackup(BACKUP_ID);

    assert.equal(stub.deleteCalls.length, 2);
    assert.equal(stub.deleteCalls[0].length, BACKUP_DELETE_BATCH_SIZE);
    assert.equal(stub.deleteCalls[1].length, 2);
    assert.equal(outcome.success, false);
    assert.equal(outcome.deletedObjects, BACKUP_DELETE_BATCH_SIZE + 1);
    assert.deepEqual(outcome.failedKeys, [backupKey("part-1000.txt")]);
    assert.equal(outcome.errors[0].retryable, false);
  });

  it("propagates a failed delete request instead of reporting a partial success", async () => {
    setBackupContents(["data.json"]);
    stub.deleteResponses = [Object.assign(new Error("connection reset"), { name: "ECONNRESET" })];

    await assert.rejects(
      () => deleteBackup(BACKUP_ID),
      /connection reset/,
      "a request that never ran must reach the caller, not be reported as a delete result"
    );
  });

  it("still refuses an unknown backup id and a backup with no objects", async () => {
    await assert.rejects(() => deleteBackup("../etc/passwd"), /Invalid backup id/);
    stub.contents = [];
    await assert.rejects(() => deleteBackup(BACKUP_ID), BackupNotFoundError);
  });
});

describe("backup deletion surfaces", () => {
  it("answers a partial deletion with a conflict instead of a success", () => {
    const source = readRepoFile("packages/frontend/app/api/admin/database/backup/[id]/route.ts");

    assert.match(source, /if \(!result\.success\)/);
    assert.match(source, /status:\s*409/);
    assert.match(source, /failedKeys:\s*result\.failedKeys/);
    assert.match(source, /deletedObjects:\s*result\.deletedObjects/);
  });

  it("keeps the backup row until the service reports every key deleted", () => {
    const source = readRepoFile("packages/frontend/app/admin/database/page.tsx");
    const handler = source.slice(source.indexOf("const handleDeleteBackup"));

    assert.match(
      handler,
      /if \(response\.ok && data\.success\)[\s\S]*prev\.filter\(\(b\) => b\.id !== id\)/,
      "the row must only be dropped on a successful response"
    );
    assert.match(handler, /data\.error/);
    assert.match(handler, /still stored/);
  });
});
