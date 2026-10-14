/**
 * Repository behavior for paged question-bank reads. tsx erases the type-only
 * Mongoose imports that the strip-types runner cannot load.
 */
import "./repository-read-failures.boot.ts";
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { restoreMongooseConnect } from "./repository-read-failures.boot.ts";
import { AnalysisReportRepository } from "../../packages/backend/src/database/repositories/AnalysisReportRepository.ts";
import { PromptRepository } from "../../packages/backend/src/database/repositories/PromptRepository.ts";
import { UniqueQuestionRepository } from "../../packages/backend/src/database/repositories/UniqueQuestionRepository.ts";
import {
  FALLBACK_PROMPT_PROJECTION,
  UNIQUE_QUESTION_PAGE_PROJECTION,
  decodeQuestionBankCursor,
  encodeQuestionBankCursor,
  isInvalidQuestionBankCursorError,
} from "../../packages/backend/src/services/questionBankPage.ts";

const SUBJECT = "Operating Systems";
const DB_DOWN = "database read failed";
const FIRST_ID = "507f1f77bcf86cd799439013";
const SECOND_ID = "507f1f77bcf86cd799439012";
const THIRD_ID = "507f1f77bcf86cd799439011";

after(() => {
  restoreMongooseConnect();
});

function useModel(repo: object, model: Record<string, unknown>) {
  (repo as { model: unknown }).model = model;
}

describe("paged unique questions", () => {
  it("omits embeddings from the unbounded subject list", async () => {
    const repo = new UniqueQuestionRepository();
    let selected: unknown;
    let limited = false;
    useModel(repo, {
      find() {
        const query = {
          select(projection: unknown) {
            selected = projection;
            return query;
          },
          sort() {
            return query;
          },
          limit() {
            limited = true;
            return query;
          },
          lean() {
            return Promise.resolve([{ _id: FIRST_ID, questionText: "Paging" }]);
          },
        };
        return query;
      },
    });

    const rows = await repo.findBySubject(SUBJECT, { sortBy: "occurrenceCount", sortOrder: "desc" });

    assert.equal(Array.isArray(rows), true);
    assert.equal(rows.length, 1);
    assert.deepEqual(selected, { embedding: 0 });
    assert.equal(limited, false);
  });

  it("returns the next cursor from the last kept question", async () => {
    const repo = new UniqueQuestionRepository();
    const rows = [
      { _id: FIRST_ID, occurrenceCount: 5, questionText: "First" },
      { _id: SECOND_ID, occurrenceCount: 4, questionText: "Second" },
      { _id: THIRD_ID, occurrenceCount: 4, questionText: "Third" },
    ];
    let selected: unknown;
    let sorted: unknown;
    let limitedTo = 0;
    useModel(repo, {
      find() {
        const query = {
          select(projection: unknown) {
            selected = projection;
            return query;
          },
          sort(spec: unknown) {
            sorted = spec;
            return query;
          },
          limit(count: number) {
            limitedTo = count;
            return query;
          },
          lean() {
            return Promise.resolve(rows.slice(0, limitedTo));
          },
        };
        return query;
      },
    });

    const page = await repo.findBySubject(SUBJECT, { limit: 2 });

    assert.equal(page.questions.length, 2);
    assert.equal(String(page.questions[1]._id), SECOND_ID);
    assert.equal(limitedTo, 3);
    assert.deepEqual(selected, UNIQUE_QUESTION_PAGE_PROJECTION);
    assert.deepEqual(sorted, { occurrenceCount: -1, _id: -1 });
    assert.equal("embedding" in (selected as object), false);
    const cursor = decodeQuestionBankCursor(page.nextCursor ?? "");
    assert.equal(cursor.kind, "question");
    if (cursor.kind === "question") {
      assert.equal(cursor.id, SECOND_ID);
      assert.equal(cursor.occurrenceCount, 4);
    }
  });

  it("rejects an unusable cursor before querying", async () => {
    const repo = new UniqueQuestionRepository();
    let queried = false;
    useModel(repo, {
      find() {
        queried = true;
        throw new Error(DB_DOWN);
      },
    });

    await assert.rejects(
      () => repo.findBySubject(SUBJECT, { limit: 5, cursor: "not-a-cursor" }),
      isInvalidQuestionBankCursorError,
    );
    await assert.rejects(
      () =>
        repo.findBySubject(SUBJECT, {
          limit: 5,
          cursor: encodeQuestionBankCursor({ kind: "prompt", id: "prompt-1" }),
        }),
      isInvalidQuestionBankCursorError,
    );
    assert.equal(queried, false);
  });

  it("propagates a failure while loading a page of questions", async () => {
    const repo = new UniqueQuestionRepository();
    useModel(repo, {
      find() {
        const query = {
          select() {
            return query;
          },
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
      },
    });

    await assert.rejects(() => repo.findBySubject(SUBJECT, { limit: 5 }), /database read failed/);
  });
});

describe("bounded report fallback", () => {
  it("limits fallback prompt ids and summarizes without a page limit", async () => {
    const repo = new AnalysisReportRepository();
    let pagePipeline = "";
    useModel(repo, {
      aggregate(pipeline: unknown) {
        pagePipeline = JSON.stringify(pipeline);
        return Promise.resolve([{ _id: "p1" }, { _id: "p2" }, { _id: "p3" }]);
      },
    });

    const page = await repo.pagePublicPromptIds(SUBJECT, { limit: 2 });

    assert.deepEqual(page.ids, ["p1", "p2"]);
    const cursor = decodeQuestionBankCursor(page.nextCursor ?? "");
    assert.deepEqual(cursor, { kind: "prompt", id: "p2" });
    assert.match(pagePipeline, /"\$limit":3/);
    assert.doesNotMatch(pagePipeline, /embedding/);

    let summaryPipeline = "";
    useModel(repo, {
      aggregate(pipeline: unknown) {
        summaryPipeline = JSON.stringify(pipeline);
        return Promise.resolve([]);
      },
    });
    const summary = await repo.summarizeFallbackPyqs(SUBJECT, "prompts");
    assert.equal(summary.uniqueQuestions, 0);
    assert.equal(summary.subjectCount, 0);
    assert.match(summaryPipeline, /"\$facet"/);
    assert.match(summaryPipeline, /"from":"prompts"/);
    assert.doesNotMatch(summaryPipeline, /"\$limit"/);
    assert.doesNotMatch(summaryPipeline, /embedding/);
    assert.doesNotMatch(summaryPipeline, /questionText/);
  });

  it("rejects a question cursor before aggregating prompt ids", async () => {
    const repo = new AnalysisReportRepository();
    let queried = false;
    useModel(repo, {
      aggregate() {
        queried = true;
        return Promise.reject(new Error(DB_DOWN));
      },
    });

    await assert.rejects(
      () =>
        repo.pagePublicPromptIds(SUBJECT, {
          limit: 5,
          cursor: encodeQuestionBankCursor({
            kind: "question",
            occurrenceCount: 1,
            id: FIRST_ID,
          }),
        }),
      isInvalidQuestionBankCursorError,
    );
    assert.equal(queried, false);
  });

  it("projects fallback prompts and still returns an empty id list without querying", async () => {
    const repo = new PromptRepository();
    let selected: unknown;
    let queried = false;
    useModel(repo, {
      find(filter: { _id?: { $in?: unknown[] } }) {
        queried = true;
        assert.equal(filter._id?.$in?.length, 1);
        assert.equal(String(filter._id?.$in?.[0]), FIRST_ID);
        const query = {
          select(projection: unknown) {
            selected = projection;
            return query;
          },
          lean() {
            return Promise.resolve([]);
          },
        };
        return query;
      },
    });

    assert.deepEqual(await repo.findByIds([]), []);
    assert.equal(queried, false);
    assert.deepEqual(await repo.findByIds([FIRST_ID], FALLBACK_PROMPT_PROJECTION), []);
    assert.deepEqual(selected, FALLBACK_PROMPT_PROJECTION);
    assert.equal("embedding" in FALLBACK_PROMPT_PROJECTION, false);
  });
});
