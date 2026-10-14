/**
 * Repository behavior for paged result history. tsx erases the type-only
 * Mongoose imports that the strip-types runner cannot load.
 */
import "./repository-read-failures.boot.ts";
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { restoreMongooseConnect } from "./repository-read-failures.boot.ts";
import { ExamRepository } from "../../packages/backend/src/database/repositories/ExamRepository.ts";
import { ExamSubmissionRepository } from "../../packages/backend/src/database/repositories/ExamSubmissionRepository.ts";
import { decodeHistoryCursor, isInvalidResultsCursorError } from "../../packages/backend/src/services/submissionHistoryPage.ts";

const USER_ID = "user_2fLq9";
const EXAM_ID = "507f1f77bcf86cd799439011";
const DB_DOWN = "database read failed";

after(() => {
  restoreMongooseConnect();
});

function useModel(repo: object, model: Record<string, unknown>) {
  (repo as { model: unknown }).model = model;
}

function chain(rows: unknown) {
  const query = {
    sort() {
      return query;
    },
    limit() {
      return query;
    },
    lean() {
      return Promise.resolve(rows);
    },
  };
  return query;
}

function failingChain() {
  const query = {
    sort() {
      return query;
    },
    limit() {
      return query;
    },
    lean() {
      return Promise.reject(new Error(DB_DOWN));
    },
  };
  return query;
}

describe("paged submission history", () => {
  it("returns an empty page when the user has no graded submissions", async () => {
    const repo = new ExamSubmissionRepository();
    let filter: unknown;
    let limitedTo = 0;
    useModel(repo, {
      find(query: unknown) {
        filter = query;
        const paging = {
          sort() {
            return paging;
          },
          limit(count: number) {
            limitedTo = count;
            return paging;
          },
          lean() {
            return Promise.resolve([]);
          },
        };
        return paging;
      },
    });

    const page = await repo.getByUser(USER_ID, { limit: 10 });

    assert.deepEqual(page.submissions, []);
    assert.equal(page.nextCursor, null);
    assert.equal(limitedTo, 11);
    assert.deepEqual(filter, { userId: USER_ID, gradingStatus: { $ne: "pending" } });
  });

  it("returns the next cursor from the last row on the page", async () => {
    const repo = new ExamSubmissionRepository();
    const rows = [
      { _id: "507f1f77bcf86cd799439013", submittedAt: new Date("2026-03-03T00:00:00.000Z"), examId: "e3" },
      { _id: "507f1f77bcf86cd799439012", submittedAt: new Date("2026-03-02T00:00:00.000Z"), examId: "e2" },
      { _id: "507f1f77bcf86cd799439011", submittedAt: new Date("2026-03-01T00:00:00.000Z"), examId: "e1" },
    ];
    useModel(repo, {
      find() {
        const paging = {
          sort() {
            return paging;
          },
          limit(count: number) {
            return {
              lean() {
                return Promise.resolve(rows.slice(0, count));
              },
            };
          },
        };
        return paging;
      },
    });

    const page = await repo.getByUser(USER_ID, { limit: 2 });

    assert.equal(page.submissions.length, 2);
    assert.equal(String(page.submissions[1]._id), "507f1f77bcf86cd799439012");
    const cursor = decodeHistoryCursor(page.nextCursor ?? "");
    assert.equal(cursor.id, "507f1f77bcf86cd799439012");
    assert.equal(cursor.submittedAt.toISOString(), "2026-03-02T00:00:00.000Z");
  });

  it("rejects an unusable cursor before querying", async () => {
    const repo = new ExamSubmissionRepository();
    let queried = false;
    useModel(repo, {
      find() {
        queried = true;
        return failingChain();
      },
    });

    await assert.rejects(
      () => repo.getByUser(USER_ID, { cursor: "not-a-cursor" }),
      isInvalidResultsCursorError,
    );
    assert.equal(queried, false);
  });

  it("propagates a failure while loading a page of submissions", async () => {
    const repo = new ExamSubmissionRepository();
    useModel(repo, {
      find() {
        return failingChain();
      },
    });

    await assert.rejects(() => repo.getByUser(USER_ID, { limit: 5 }), /database read failed/);
  });
});

describe("summarized submission history", () => {
  it("reads an empty aggregation as zeroes and does not limit the pipeline", async () => {
    const repo = new ExamSubmissionRepository();
    let pipeline = "";
    useModel(repo, {
      aggregate(stages: unknown) {
        pipeline = JSON.stringify(stages);
        return Promise.resolve([]);
      },
    });

    const summary = await repo.summarizeByUser(USER_ID);

    assert.equal(summary.totalExams, 0);
    assert.deepEqual(summary.grades, []);
    assert.match(pipeline, /"\$lookup"/);
    assert.match(pipeline, /"\$facet"/);
    assert.doesNotMatch(pipeline, /"\$limit"/);
    assert.equal(pipeline.includes("deletedAt"), false);
  });

  it("propagates a failure while summarizing submissions", async () => {
    const repo = new ExamSubmissionRepository();
    useModel(repo, {
      aggregate() {
        return Promise.reject(new Error(DB_DOWN));
      },
    });

    await assert.rejects(() => repo.summarizeByUser(USER_ID), /database read failed/);
  });
});

describe("historical exam batch", () => {
  it("skips ids that cannot name an exam and loads the rest in one $in query", async () => {
    const repo = new ExamRepository();
    let queried = false;
    let filter: { _id?: { $in?: unknown[] } } | undefined;
    useModel(repo, {
      find(query: { _id?: { $in?: unknown[] } }) {
        queried = true;
        filter = query;
        return chain([]);
      },
    });

    assert.deepEqual(await repo.getHistoricalByIds([]), []);
    assert.deepEqual(await repo.getHistoricalByIds(["", "not-an-id"]), []);
    assert.equal(queried, false);

    assert.deepEqual(await repo.getHistoricalByIds([EXAM_ID, EXAM_ID, "not-an-id"]), []);
    assert.equal(queried, true);
    assert.equal(filter?._id?.$in?.length, 1);
    assert.equal(String(filter?._id?.$in?.[0]), EXAM_ID);
    assert.equal(JSON.stringify(filter).includes("deletedAt"), false);
  });

  it("propagates a failure while batch-loading exams", async () => {
    const repo = new ExamRepository();
    useModel(repo, {
      find() {
        return failingChain();
      },
    });

    await assert.rejects(() => repo.getHistoricalByIds([EXAM_ID]), /database read failed/);
  });
});
