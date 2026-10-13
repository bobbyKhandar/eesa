import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { orderQuestionDetails } from "../../packages/backend/src/database/questionOrder.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

function methodBody(source: string, signature: string): string {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `missing ${signature}`);
  const next = source.indexOf("\n  async ", start + signature.length);
  return source.slice(start, next === -1 ? source.length : next);
}

/** Mimics a Mongo ObjectId: equality is by hex string, not by object identity. */
function objectId(hex: string) {
  return { toString: () => hex };
}

describe("orderQuestionDetails", () => {
  const authored = ["q-a", "q-b", "q-c"];

  it("restores the exam.questions sequence when the join returns a different order", () => {
    const reversed = [
      { _id: "q-c", marks: 3, promptData: { questionText: "C" } },
      { _id: "q-a", marks: 1, promptData: { questionText: "A" } },
      { _id: "q-b", marks: 2, promptData: { questionText: "B" } },
    ];

    const ordered = orderQuestionDetails(authored, reversed);

    assert.deepEqual(
      ordered.map((question) => question._id),
      ["q-a", "q-b", "q-c"],
    );
    assert.equal(ordered[0], reversed[1]);
    assert.deepEqual(ordered.map((question) => question.promptData.questionText), ["A", "B", "C"]);
    assert.deepEqual(
      reversed.map((question) => question._id),
      ["q-c", "q-a", "q-b"],
    );
  });

  it("matches string ids stored on the exam with ObjectId _id values from the join", () => {
    const details = [
      { _id: objectId("bbbbbbbbbbbbbbbbbbbbbbbb"), marks: 2 },
      { _id: objectId("aaaaaaaaaaaaaaaaaaaaaaaa"), marks: 1 },
    ];

    const ordered = orderQuestionDetails(
      ["aaaaaaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbbbbbbbb"],
      details,
    );

    assert.deepEqual(
      ordered.map((question) => question._id.toString()),
      ["aaaaaaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbbbbbbbb"],
    );
  });

  it("matches an authored ObjectId with a string _id from the join", () => {
    const ordered = orderQuestionDetails(
      [objectId("q-b"), objectId("q-a")],
      [{ _id: "q-a" }, { _id: "q-b" }],
    );

    assert.deepEqual(
      ordered.map((question) => question._id),
      ["q-b", "q-a"],
    );
  });

  it("skips an authored id the join did not return and keeps every joined question", () => {
    const extra = { _id: "q-extra", marks: 9 };
    const ordered = orderQuestionDetails(authored, [
      extra,
      { _id: "q-c", marks: 3 },
      { _id: "q-a", marks: 1 },
    ]);

    assert.deepEqual(
      ordered.map((question) => question._id),
      ["q-a", "q-c", "q-extra"],
    );
  });

  it("places a duplicated authored id only as many times as the join returned that question", () => {
    const only = { _id: "q-a", marks: 1 };
    const ordered = orderQuestionDetails(["q-a", "q-a", "q-b"], [{ _id: "q-b", marks: 2 }, only]);

    assert.deepEqual(
      ordered.map((question) => question._id),
      ["q-a", "q-b"],
    );
    assert.equal(ordered[0], only);
  });

  it("keeps an already-authored order unchanged", () => {
    const details = authored.map((id) => ({ _id: id }));
    assert.deepEqual(
      orderQuestionDetails(authored, details).map((question) => question._id),
      authored,
    );
  });

  it("returns no questions when the join is empty", () => {
    assert.deepEqual(orderQuestionDetails(authored, []), []);
    assert.deepEqual(orderQuestionDetails(authored, null), []);
    assert.deepEqual(orderQuestionDetails(authored, undefined), []);
  });

  it("leaves joined questions in place when the exam has no authored id list", () => {
    const details = [{ _id: "q-b" }, { _id: "q-a" }];
    assert.deepEqual(orderQuestionDetails(undefined, details), details);
    assert.deepEqual(orderQuestionDetails(null, details), details);
    assert.notEqual(orderQuestionDetails(null, details), details);
  });
});

describe("getWithFullDetails preserves authored question order", () => {
  it("reorders the lookup result and still returns a deleted exam", () => {
    const source = read("packages/backend/src/database/repositories/ExamRepository.ts");
    const body = methodBody(source, "async getWithFullDetails(");
    assert.match(body, /orderQuestionDetails\(/);
    assert.match(body, /\$indexOfArray:\s*\['\$\$questionIds',\s*'\$_idStr'\]/);
    assert.match(body, /\$sort:\s*\{\s*_authoredOrder:\s*1\s*\}/);
    assert.match(body, /\$unset:\s*'_authoredOrder'/);
    assert.match(body, /\$in/);
    assert.doesNotMatch(body, /activeExamQuery|deletedAt/);
  });

  it("renders exam and submission questions from questionDetails order", () => {
    const examRoute = read("packages/frontend/app/api/exams/[id]/route.ts");
    assert.match(examRoute, /toExamineeExam\(exam\)/);

    const submissionRoute = read("packages/frontend/app/api/submissions/[id]/route.ts");
    assert.match(submissionRoute, /questionDetails\?\.map/);
    assert.doesNotMatch(submissionRoute, /questionDetails\?\.sort|questionDetails\.sort/);
  });
});
