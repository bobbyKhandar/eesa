/**
 * Repository writes with a stubbed model. A partial insertMany must delete the
 * documents it already stored when no transaction is open, and must leave that
 * cleanup to the transaction when a session is open.
 */
import "./repository-read-failures.boot.ts";
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import mongoose from "mongoose";
import { restoreMongooseConnect } from "./repository-read-failures.boot.ts";
import {
  ExamCreationAborted,
  isTransactionsUnsupportedError,
} from "../../packages/backend/src/database/examWriteRollback.ts";
import { ExamQuestionRepository } from "../../packages/backend/src/database/repositories/ExamQuestionRepository.ts";
import { ExamRepository } from "../../packages/backend/src/database/repositories/ExamRepository.ts";
import { PromptRepository } from "../../packages/backend/src/database/repositories/PromptRepository.ts";

mongoose.set("bufferCommands", false);

after(() => {
  restoreMongooseConnect();
});

const PROMPT_A = "64b0000000000000000000a1";
const PROMPT_B = "64b0000000000000000000b2";
const QUESTION_A = "64b0000000000000000000c3";
const QUESTION_B = "64b0000000000000000000c4";
const REPLICA_SET_ERROR = "Transaction numbers are only allowed on a replica set member or mongos";

interface InsertCall {
  docs: unknown[];
  options: unknown;
}

function objectId(hex: string) {
  return { toString: () => hex, _bsontype: "ObjectId" };
}

function useModel(repo: object, model: Record<string, unknown>) {
  (repo as { model: unknown }).model = model;
}

function bulkFailure() {
  return Object.assign(new Error("E11000 duplicate key"), {
    insertedDocs: [{ _id: objectId(PROMPT_A) }],
    insertedIds: { 1: objectId(PROMPT_B) },
  });
}

function recordingModel(fail: () => Error | null) {
  const calls: InsertCall[] = [];
  const deleted: string[][] = [];
  const model = {
    async insertMany(docs: unknown[], options?: unknown) {
      calls.push({ docs, options });
      const error = fail();
      if (error) throw error;
      return (docs as Array<{ promptId?: string }>).map((doc, index) => ({
        _id: objectId(doc.promptId ? (index === 0 ? QUESTION_A : QUESTION_B) : index === 0 ? PROMPT_A : PROMPT_B),
      }));
    },
    async deleteMany(filter: { _id: { $in: Array<{ toString(): string }> } }) {
      deleted.push(filter._id.$in.map((id) => id.toString()));
      return { deletedCount: filter._id.$in.length };
    },
  };
  return { model, calls, deleted };
}

const textQuestion = {
  promptId: PROMPT_A,
  marks: 5,
  questionType: "TEXT" as const,
  answer: "water movement",
};

const mcqQuestion = {
  promptId: PROMPT_B,
  marks: 2,
  questionType: "MCQ" as const,
  answer: [1],
  options: [
    { text: "Iron", isCorrect: false },
    { text: "Oxygen", isCorrect: true },
  ],
};

const promptInput = {
  questionText: "Explain osmosis.",
  subject: "Biology",
  generateVia: "user" as const,
  createdBy: "teacher_1",
};

describe("ExamQuestionRepository.createBulk", () => {
  it("deletes documents insertMany stored before a bulk failure", async () => {
    const repo = new ExamQuestionRepository();
    const { model, calls, deleted } = recordingModel(() => bulkFailure());
    useModel(repo, model);

    const result = await repo.createBulk([textQuestion, { ...mcqQuestion }]);

    assert.equal(result.success, false);
    assert.equal(result.error, "Failed to create exam questions in bulk");
    assert.equal(calls.length, 1);
    assert.deepEqual(deleted, [[PROMPT_A, PROMPT_B]]);
  });

  it("does not delete inside an open session so the transaction can abort", async () => {
    const repo = new ExamQuestionRepository();
    const { model, calls, deleted } = recordingModel(() => bulkFailure());
    useModel(repo, model);
    const session = { id: "txn" };

    await assert.rejects(
      () => repo.createBulk([textQuestion], { session: session as never }),
      (error: unknown) => {
        assert.ok(error instanceof ExamCreationAborted);
        assert.equal(error.message, "Failed to create exam questions in bulk");
        assert.deepEqual([...error.examQuestionIds], [PROMPT_A, PROMPT_B]);
        return true;
      },
    );
    assert.deepEqual((calls[0]?.options as { session?: unknown }).session, session);
    assert.deepEqual(deleted, []);
  });

  it("rethrows a standalone-server transaction error without deleting", async () => {
    const repo = new ExamQuestionRepository();
    const { model, deleted } = recordingModel(() => Object.assign(new Error("bulk failed"), { cause: new Error(REPLICA_SET_ERROR) }));
    useModel(repo, model);

    await assert.rejects(
      () => repo.createBulk([textQuestion], { session: { id: "txn" } as never }),
      (error: unknown) => isTransactionsUnsupportedError(error),
    );
    assert.deepEqual(deleted, []);
  });
});

describe("PromptRepository.createBulk", () => {
  it("deletes prompts insertMany stored before a bulk failure", async () => {
    const repo = new PromptRepository();
    const { model, deleted } = recordingModel(() => bulkFailure());
    useModel(repo, model);

    const result = await repo.createBulk([promptInput, { ...promptInput, questionText: "Name the gas." }]);

    assert.equal(result.success, false);
    assert.equal(result.error, "Failed to create prompts in bulk");
    assert.deepEqual(deleted, [[PROMPT_A, PROMPT_B]]);
  });

  it("does not delete prompts inside an open session", async () => {
    const repo = new PromptRepository();
    const { model, deleted } = recordingModel(() => bulkFailure());
    useModel(repo, model);

    await assert.rejects(
      () => repo.createBulk([promptInput], { session: { id: "txn" } as never }),
      (error: unknown) => error instanceof ExamCreationAborted && error.message === "Failed to create prompts in bulk",
    );
    assert.deepEqual(deleted, []);
  });
});

describe("ExamRepository.createWithPrompts", () => {
  function examRepoWith(questionModel: Record<string, unknown>, examModel: Record<string, unknown>) {
    const repo = new ExamRepository();
    const questions = new ExamQuestionRepository();
    useModel(questions, questionModel);
    (repo as { examQuestionRepo: ExamQuestionRepository }).examQuestionRepo = questions;
    useModel(repo, examModel);
    return repo;
  }

  const examData = {
    examTitle: "Cells",
    examDescription: "Short quiz",
    subject: "Biology",
    examDegree: "BSc",
    examType: "personal",
    passingPercentage: 40,
    createdBy: "teacher_1",
    assignedUsers: ["teacher_1"],
    questions: [textQuestion, mcqQuestion],
  };

  it("rolls back exam questions inserted before the exam insert fails", async () => {
    const questions = recordingModel(() => null);
    const exams = recordingModel(() => new Error("exam insert failed"));
    const repo = examRepoWith(questions.model, exams.model);

    const result = await repo.createWithPrompts(examData);

    assert.deepEqual(result, { success: false, error: "Failed to create exam with prompts" });
    assert.deepEqual(questions.deleted, [[QUESTION_A, QUESTION_B]]);
    const inserted = exams.calls[0]?.docs as Array<{ questions: string[] }>;
    assert.deepEqual(inserted[0]?.questions, [QUESTION_A, QUESTION_B]);
  });

  it("leaves exam-question cleanup to the session when the exam insert fails", async () => {
    const questions = recordingModel(() => null);
    const exams = recordingModel(() => new Error("exam insert failed"));
    const repo = examRepoWith(questions.model, exams.model);
    const session = { id: "txn" };

    await assert.rejects(
      () => repo.createWithPrompts(examData, { session: session as never }),
      (error: unknown) => error instanceof ExamCreationAborted && error.message === "Failed to create exam with prompts",
    );
    assert.deepEqual(questions.deleted, []);
    assert.equal((exams.calls[0]?.options as { session?: unknown }).session, session);
  });

  it("returns the bulk error after createBulk has already removed a partial question insert", async () => {
    const questions = recordingModel(() => bulkFailure());
    const exams = recordingModel(() => null);
    const repo = examRepoWith(questions.model, exams.model);

    const result = await repo.createWithPrompts(examData);

    assert.equal(result.success, false);
    assert.equal(result.error, "Failed to create exam questions in bulk");
    assert.deepEqual(questions.deleted, [[PROMPT_A, PROMPT_B]]);
    assert.equal(exams.calls.length, 0);
  });

  it("stores question ids in authored order when the exam insert succeeds", async () => {
    const questions = recordingModel(() => null);
    let stored: string[] = [];
    const exams = {
      async insertMany(docs: Array<{ questions: string[]; _id: { toString(): string } }>) {
        stored = docs[0]?.questions ?? [];
        return [{ _id: objectId("64b0000000000000000000d4") }];
      },
    };
    const repo = examRepoWith(questions.model, exams);

    const result = await repo.createWithPrompts(examData);

    assert.equal(result.success, true);
    assert.equal(result.examId, "64b0000000000000000000d4");
    assert.deepEqual(stored, [QUESTION_A, QUESTION_B]);
    assert.deepEqual(questions.deleted, []);
  });
});
