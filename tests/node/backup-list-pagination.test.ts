/**
 * Listing backups must return the whole catalogue, not the first S3 page.
 *
 * S3 caps a single ListObjectsV2 response at 1,000 results, and with a
 * delimiter each backup folder is one common prefix. When the catalogue is
 * larger than that, the first response is truncated: because folder ids are ISO
 * timestamps, the entries left off sort after (are newer than) the ones on the
 * first page. Reading only that page presented it as the complete catalogue and
 * hid the newest recovery points from restore and delete.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";

import { listBackups } from "../../packages/backend/src/services/databaseBackupService.ts";

const BACKUP_PREFIX = "database-backups";
/** S3 returns at most this many results per ListObjectsV2 response. */
const S3_PAGE_SIZE = 1000;

/** Folder ids are generated as `backup_<iso timestamp with : and . replaced>`. */
function backupId(index: number): string {
  return `backup_2026-01-01T00-00-00-${String(index).padStart(5, "0")}Z`;
}

function folderPrefix(index: number): string {
  return `${BACKUP_PREFIX}/${backupId(index)}/`;
}

function metadata(index: number): Record<string, unknown> {
  return {
    id: backupId(index),
    // Lexicographic order of these strings matches the index order, so the
    // service's descending sort puts higher (newer) indices first.
    timestamp: `2026-01-01T00:00:00.${String(index).padStart(5, "0")}Z`,
    size: index + 1,
    collectionCounts: { questions: index },
    totalDocuments: index,
    status: "completed",
  };
}

interface ListPage {
  CommonPrefixes: Array<{ Prefix: string }>;
  Contents: Array<{ Key: string; Size: number }>;
  IsTruncated: boolean;
  NextContinuationToken?: string;
}

/** Split the indices into ListObjectsV2 pages of at most `S3_PAGE_SIZE`. */
function buildPages(
  indices: number[],
  pageSize: number = S3_PAGE_SIZE,
): ListPage[] {
  const pages: ListPage[] = [];
  for (let start = 0; start < indices.length; start += pageSize) {
    const slice = indices.slice(start, start + pageSize);
    const truncated = start + pageSize < indices.length;
    pages.push({
      CommonPrefixes: slice.map((index) => ({ Prefix: folderPrefix(index) })),
      Contents: [],
      IsTruncated: truncated,
      NextContinuationToken: truncated
        ? `token-${pages.length + 1}`
        : undefined,
    });
  }
  return pages;
}

function readRepoFile(relativePath: string): string {
  return readFileSync(
    new URL(`../../${relativePath}`, import.meta.url),
    "utf8",
  );
}

describe("listBackups", () => {
  const originalSend = S3Client.prototype.send;

  let pages: ListPage[];
  /** ContinuationToken values sent with each ListObjectsV2 request, in order. */
  let listCalls: Array<string | undefined>;
  /** Backup ids whose metadata.json GetObject must fail (exercises the fallback). */
  let missingMetadata: Set<string>;

  beforeEach(() => {
    pages = [];
    listCalls = [];
    missingMetadata = new Set();
    S3Client.prototype.send = async function send(command: any) {
      if (command instanceof ListObjectsV2Command) {
        listCalls.push(command.input.ContinuationToken);
        const page = pages.shift();
        if (!page) throw new Error("unexpected extra ListObjectsV2 request");
        return page;
      }
      if (command instanceof GetObjectCommand) {
        const key: string = command.input.Key;
        const id = key
          .replace(`${BACKUP_PREFIX}/`, "")
          .replace(/\/metadata\.json$/, "");
        if (missingMetadata.has(id)) {
          throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
        }
        const index = Number.parseInt(id.slice(-6, -1), 10);
        return {
          Body: {
            transformToString: async () => JSON.stringify(metadata(index)),
          },
        };
      }
      throw new Error(`Unexpected S3 command: ${command.constructor.name}`);
    } as any;
  });

  afterEach(() => {
    S3Client.prototype.send = originalSend;
  });

  it("does not fetch another page when the first listing is not truncated", async () => {
    pages = buildPages(Array.from({ length: 5 }, (_, i) => i));

    const backups = await listBackups();

    assert.equal(listCalls.length, 1);
    assert.equal(listCalls[0], undefined);
    assert.equal(backups.length, 5);
    assert.equal(backups[0].id, backupId(4));
    assert.equal(backups[4].id, backupId(0));
  });

  it("does not request a second page for a catalogue of exactly 1,000 backups", async () => {
    pages = buildPages(Array.from({ length: S3_PAGE_SIZE }, (_, i) => i));

    const backups = await listBackups();

    // A full but non-truncated first page still has IsTruncated === false, so
    // no continuation token is sent.
    assert.equal(listCalls.length, 1);
    assert.equal(backups.length, S3_PAGE_SIZE);
  });

  it("returns the complete catalogue across a truncated listing", async () => {
    // 1,002 folders: S3 returns 1,000 then truncates the remaining 2.
    pages = buildPages(Array.from({ length: S3_PAGE_SIZE + 2 }, (_, i) => i));

    const backups = await listBackups();

    assert.equal(listCalls.length, 2);
    assert.equal(backups.length, S3_PAGE_SIZE + 2);
    // The two entries S3 would have left off the first page are the newest
    // recovery points, exactly the ones the truncated read used to hide.
    assert.ok(
      backups.some((b) => b.id === backupId(S3_PAGE_SIZE)),
      "the backup on the second page must be present",
    );
    assert.ok(
      backups.some((b) => b.id === backupId(S3_PAGE_SIZE + 1)),
      "the newest backup must be present",
    );
  });

  it("sends the continuation token from a truncated response on the next request", async () => {
    pages = buildPages(Array.from({ length: S3_PAGE_SIZE + 1 }, (_, i) => i));

    await listBackups();

    assert.equal(listCalls.length, 2);
    assert.equal(listCalls[0], undefined, "the first request carries no token");
    assert.equal(
      listCalls[1],
      "token-1",
      "the second request reuses NextContinuationToken",
    );
  });

  it("keeps following the token through every page, not just one continuation", async () => {
    // Three pages: 1,000 + 1,000 + 200.
    pages = buildPages(
      Array.from({ length: S3_PAGE_SIZE * 2 + 200 }, (_, i) => i),
    );

    const backups = await listBackups();

    assert.equal(listCalls.length, 3);
    assert.deepEqual(listCalls, [undefined, "token-1", "token-2"]);
    assert.equal(backups.length, S3_PAGE_SIZE * 2 + 200);
    // The newest backup only exists on the last page and must sort to the top.
    assert.equal(backups[0].id, backupId(S3_PAGE_SIZE * 2 + 199));
    assert.equal(backups[backups.length - 1].id, backupId(0));
  });

  it("sorts the whole catalogue newest first after pagination completes", async () => {
    pages = buildPages(Array.from({ length: S3_PAGE_SIZE + 3 }, (_, i) => i));

    const backups = await listBackups();

    const timestamps = backups.map((b) => b.timestamp);
    const sorted = [...timestamps].sort((a, b) => b.localeCompare(a));
    assert.deepEqual(
      timestamps,
      sorted,
      "backups must be ordered newest first",
    );
  });

  it("keeps a later-page backup whose metadata is missing instead of dropping it", async () => {
    const indices = Array.from({ length: S3_PAGE_SIZE + 1 }, (_, i) => i);
    pages = buildPages(indices);
    // The newest backup lives only on the second page and has no metadata.json.
    missingMetadata.add(backupId(S3_PAGE_SIZE));

    const backups = await listBackups();

    assert.equal(backups.length, S3_PAGE_SIZE + 1);
    const fallback = backups.find((b) => b.id === backupId(S3_PAGE_SIZE));
    assert.ok(
      fallback,
      "a missing-metadata backup on a later page must still be listed",
    );
    assert.equal(fallback!.status, "completed");
    assert.match(fallback!.error ?? "", /metadata is missing/);
  });
});

describe("backup listing pagination guards", () => {
  it("follows the S3 continuation token instead of trusting a single page", () => {
    const source = readRepoFile(
      "packages/backend/src/services/databaseBackupService.ts",
    );
    const listing = source.slice(
      source.indexOf("export async function listBackups"),
    );

    assert.match(
      listing,
      /IsTruncated/,
      "must inspect whether the response is truncated",
    );
    assert.match(
      listing,
      /NextContinuationToken/,
      "must read the continuation token",
    );
    assert.match(
      listing,
      /ContinuationToken:\s*continuationToken/,
      "must send the token back",
    );
    assert.match(
      listing,
      /while \(continuationToken\)/,
      "must loop until the listing completes",
    );
  });

  it("exposes the service result as one complete successful payload", () => {
    const source = readRepoFile(
      "packages/frontend/app/api/admin/database/backup/route.ts",
    );

    // The service now returns the whole catalogue, so the API forwards it as-is
    // with no client-driven paging to truncate it.
    assert.match(source, /const backups = await listBackups\(\)/);
    assert.match(source, /data:\s*backups/);
  });
});
