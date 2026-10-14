/**
 * A failed exam create must not leave Prompt or ExamQuestion documents behind.
 * Transactions are used when the server accepts them. Standalone MongoDB does
 * not, so the same failure deletes the ids recorded before the error.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ExamCreationAborted,
  insertedIdsFromBulkError,
  isTransactionsUnsupportedError,
} from "../../packages/backend/src/database/examWriteRollback.ts";
import { runOptionalTransaction } from "../../packages/backend/src/database/optionalTransaction.ts";
import {
  commitExamCreation,
  type ExamCreationInput,
  type ExamCreationPorts,
} from "../../packages/backend/src/services/examCreationCommit.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

const PROMPT_A = "64b0000000000000000000a1";
const PROMPT_B = "64b0000000000000000000b2";
const QUESTION_A = "64b0000000000000000000c3";
const EXAM_ID = "64b0000000000000000000d4";

const REPLICA_SET_ERROR = "Transaction numbers are only allowed on a replica set member or mongos";

function sampleInput(): ExamCreationInput {
  return {
    prompts: [
      { questionText: "Explain osmosis.", subject: "Biology", generateVia: "user", createdBy: "teacher_1" },
      { questionText: "Name the gas.", subject: "Biology", generateVia: "user", createdBy: "teacher_1" },
    ],
    questions: [
      { marks: 5, questionType: "TEXT", answer: "water movement" },
      {
        marks: 2,
        questionType: "MCQ",
        answer: [1],
        options: [
          { text: "Iron", isCorrect: false },
          { text: "Oxygen", isCorrect: true },
        ],
      },
    ],
    exam: {
      examTitle: "Cells",
      examDescription: "Short quiz",
      subject: "Biology",
      examDegree: "BSc",
      examType: "personal",
      passingPercentage: 40,
      createdBy: "teacher_1",
      assignedUsers: ["teacher_1"],
    },
  };
}

interface FakeSession {
  withTransaction(work: () => Promise<unknown>): Promise<unknown>;
  endSession(): void;
}

function trackingPorts(overrides: Partial<ExamCreationPorts<FakeSession>> = {}) {
  const deletedPrompts: string[][] = [];
  const deletedQuestions: string[][] = [];
  const sessions: Array<FakeSession | null> = [];
  const ports: ExamCreationPorts<FakeSession> = {
    async runTransaction(work) {
      const session: FakeSession = {
        async withTransaction(fn) {
          await fn();
        },
        endSession() {},
      };
      return { supported: true, value: await work(session) };
    },
    async createPrompts(_prompts, session) {
      sessions.push(session);
      return { success: true, promptIds: [PROMPT_A, PROMPT_B] };
    },
    async createExam(exam, session) {
      sessions.push(session);
      assert.deepEqual(
        exam.questions.map((question) => question.promptId),
        [PROMPT_A, PROMPT_B],
      );
      return { success: true, examId: EXAM_ID };
    },
    async deletePrompts(ids) {
      deletedPrompts.push([...ids]);
    },
    async deleteExamQuestions(ids) {
      deletedQuestions.push([...ids]);
    },
    ...overrides,
  };
  return { ports, deletedPrompts, deletedQuestions, sessions };
}

describe("insertedIdsFromBulkError", () => {
  it("collects mongoose insertedDocs and driver insertedIds, once each", () => {
    const ids = insertedIdsFromBulkError({
      insertedDocs: [{ _id: { toString: () => PROMPT_A, _bsontype: "ObjectId" } }],
      insertedIds: { 0: PROMPT_A, 1: PROMPT_B },
      writeErrors: [{ index: 2, op: { _id: "64b000000000000000000099" } }],
    });

    assert.deepEqual(ids, [PROMPT_A, PROMPT_B]);
  });

  it("reads ids nested on the bulk result and ignores non-ids", () => {
    const ids = insertedIdsFromBulkError({
      message: "bulk failed",
      result: { result: { insertedIds: { 0: { toString: () => QUESTION_A, _bsontype: "ObjectId" } } } },
      note: "not-an-id",
    });

    assert.deepEqual(ids, [QUESTION_A]);
    assert.deepEqual(insertedIdsFromBulkError(null), []);
    assert.deepEqual(insertedIdsFromBulkError(new Error("validation failed")), []);
  });
});

describe("isTransactionsUnsupportedError", () => {
  it("recognizes a standalone server, including when the driver wraps the message", () => {
    assert.equal(isTransactionsUnsupportedError(new Error(REPLICA_SET_ERROR)), true);
    assert.equal(
      isTransactionsUnsupportedError(Object.assign(new Error("bulk write failed"), { cause: new Error(REPLICA_SET_ERROR) })),
      true,
    );
    assert.equal(
      isTransactionsUnsupportedError({ errorResponse: { errmsg: REPLICA_SET_ERROR, code: 20, codeName: "IllegalOperation" } }),
      true,
    );
  });

  it("does not treat a business failure or an unrelated illegal operation as missing transaction support", () => {
    assert.equal(isTransactionsUnsupportedError(new ExamCreationAborted("Failed to create exam")), false);
    assert.equal(isTransactionsUnsupportedError(Object.assign(new Error("invalid namespace"), { code: 20 })), false);
    assert.equal(isTransactionsUnsupportedError(new Error("E11000 duplicate key")), false);
  });
});

describe("runOptionalTransaction", () => {
  it("returns the committed value and ends the session", async () => {
    let ended = false;
    const result = await runOptionalTransaction(
      async (session) => {
        assert.equal(session.tag, "live");
        return "exam-id";
      },
      async () => ({
        tag: "live",
        async withTransaction(work) {
          await work();
        },
        endSession() {
          ended = true;
        },
      }),
    );

    assert.deepEqual(result, { supported: true, value: "exam-id" });
    assert.equal(ended, true);
  });

  it("reports unsupported when the server rejects the transaction and still ends the session", async () => {
    let ended = false;
    const result = await runOptionalTransaction(
      async () => {
        throw new Error(REPLICA_SET_ERROR);
      },
      async () => ({
        async withTransaction(work) {
          await work();
        },
        endSession() {
          ended = true;
        },
      }),
    );

    assert.deepEqual(result, { supported: false });
    assert.equal(ended, true);
  });

  it("rethrows an aborted exam write after ending the session", async () => {
    let ended = false;
    await assert.rejects(
      () =>
        runOptionalTransaction(
          async () => {
            throw new ExamCreationAborted("Failed to create prompts in bulk", { promptIds: [PROMPT_A] });
          },
          async () => ({
            async withTransaction(work) {
              await work();
            },
            endSession() {
              ended = true;
            },
          }),
        ),
      (error: unknown) => error instanceof ExamCreationAborted && error.message === "Failed to create prompts in bulk",
    );
    assert.equal(ended, true);
  });
});

describe("commitExamCreation", () => {
  it("keeps prompt order and skips compensating deletes when the transaction commits", async () => {
    const { ports, deletedPrompts, deletedQuestions, sessions } = trackingPorts();

    const result = await commitExamCreation(sampleInput(), ports);

    assert.deepEqual(result, { success: true, examId: EXAM_ID });
    assert.deepEqual(deletedPrompts, []);
    assert.deepEqual(deletedQuestions, []);
    assert.equal(sessions.filter((session) => session === null).length, 0);
    assert.equal(sessions.length, 2);
  });

  it("returns the exam error and does not delete when the transaction aborts", async () => {
    const { ports, deletedPrompts, deletedQuestions } = trackingPorts({
      async createExam() {
        return { success: false, error: "Failed to create exam with prompts", examQuestionIds: [QUESTION_A] };
      },
    });

    const result = await commitExamCreation(sampleInput(), ports);

    assert.deepEqual(result, { success: false, error: "Failed to create exam with prompts" });
    assert.deepEqual(deletedPrompts, []);
    assert.deepEqual(deletedQuestions, []);
  });

  it("keeps the prompt error when the abort was constructed in another module copy", async () => {
    let examCalls = 0;
    const { ports, deletedPrompts } = trackingPorts({
      async createPrompts() {
        throw Object.assign(new Error("Failed to create prompts in bulk"), {
          name: "ExamCreationAborted",
          promptIds: [PROMPT_A],
          examQuestionIds: [],
        });
      },
      async createExam() {
        examCalls += 1;
        return { success: true, examId: EXAM_ID };
      },
    });

    const result = await commitExamCreation(sampleInput(), ports);

    assert.deepEqual(result, { success: false, error: "Failed to create prompts in bulk" });
    assert.equal(examCalls, 0);
    assert.deepEqual(deletedPrompts, []);
  });

  it("returns the prompt error and does not create an exam when the transaction aborts first", async () => {
    let examCalls = 0;
    const { ports, deletedPrompts } = trackingPorts({
      async createPrompts() {
        throw new ExamCreationAborted("Failed to create prompts in bulk", { promptIds: [PROMPT_A] });
      },
      async createExam() {
        examCalls += 1;
        return { success: true, examId: EXAM_ID };
      },
    });

    const result = await commitExamCreation(sampleInput(), ports);

    assert.deepEqual(result, { success: false, error: "Failed to create prompts in bulk" });
    assert.equal(examCalls, 0);
    assert.deepEqual(deletedPrompts, []);
  });

  it("falls back to compensating deletes when transactions are unsupported", async () => {
    const seen: Array<FakeSession | null> = [];
    const { ports, deletedPrompts, deletedQuestions } = trackingPorts({
      async runTransaction(work) {
        try {
          await work({
            async withTransaction() {
              throw new Error("not used");
            },
            endSession() {},
          });
        } catch (error) {
          if (!isTransactionsUnsupportedError(error)) throw error;
        }
        return { supported: false };
      },
      async createPrompts(_prompts, session) {
        seen.push(session);
        if (session) throw Object.assign(new Error("insert failed"), { cause: new Error(REPLICA_SET_ERROR) });
        return { success: true, promptIds: [PROMPT_A, PROMPT_B] };
      },
      async createExam(_exam, session) {
        seen.push(session);
        return { success: false, error: "Failed to create exam with prompts", examQuestionIds: [QUESTION_A] };
      },
    });

    const result = await commitExamCreation(sampleInput(), ports);

    assert.deepEqual(result, { success: false, error: "Failed to create exam with prompts" });
    assert.equal(seen.length, 3);
    assert.notEqual(seen[0], null);
    assert.equal(seen[1], null);
    assert.equal(seen[2], null);
    assert.deepEqual(deletedPrompts, [[PROMPT_A, PROMPT_B]]);
    assert.deepEqual(deletedQuestions, [[QUESTION_A]]);
  });

  it("deletes partial prompt ids when the non-transactional prompt write fails", async () => {
    let examCalls = 0;
    const { ports, deletedPrompts, deletedQuestions } = trackingPorts({
      async runTransaction() {
        return { supported: false };
      },
      async createPrompts() {
        return { success: false, error: "Failed to create prompts in bulk", promptIds: [PROMPT_A] };
      },
      async createExam() {
        examCalls += 1;
        return { success: true, examId: EXAM_ID };
      },
    });

    const result = await commitExamCreation(sampleInput(), ports);

    assert.deepEqual(result, { success: false, error: "Failed to create prompts in bulk" });
    assert.equal(examCalls, 0);
    assert.deepEqual(deletedPrompts, [[PROMPT_A]]);
    assert.deepEqual(deletedQuestions, []);
  });

  it("still returns the original error when a compensating delete fails", async () => {
    let questionDeletes = 0;
    const { ports } = trackingPorts({
      async runTransaction() {
        return { supported: false };
      },
      async createExam() {
        return { success: false, error: "Failed to create exam with prompts", examQuestionIds: [QUESTION_A] };
      },
      async deletePrompts() {
        throw new Error("prompt delete failed");
      },
      async deleteExamQuestions() {
        questionDeletes += 1;
      },
    });

    const result = await commitExamCreation(sampleInput(), ports);

    assert.deepEqual(result, { success: false, error: "Failed to create exam with prompts" });
    assert.equal(questionDeletes, 1);
  });

  it("does not delete after a non-transactional success", async () => {
    const { ports, deletedPrompts, deletedQuestions, sessions } = trackingPorts({
      async runTransaction() {
        return { supported: false };
      },
    });

    const result = await commitExamCreation(sampleInput(), ports);

    assert.deepEqual(result, { success: true, examId: EXAM_ID });
    assert.deepEqual(deletedPrompts, []);
    assert.deepEqual(deletedQuestions, []);
    assert.deepEqual(sessions, [null, null]);
  });
});

describe("exam creation route keeps prior guarantees and commits writes together", () => {
  const route = read("packages/frontend/app/api/exams/create/route.ts");

  it("validates question types and student assignees before any prompt write", () => {
    const validationIndex = route.indexOf("findInvalidQuestion(questions)");
    const assigneeIndex = route.indexOf("findMissingStudentAssignees(");
    const promptIndex = route.indexOf("promptRepo.createBulk(");
    assert.ok(validationIndex > -1 && assigneeIndex > validationIndex && promptIndex > assigneeIndex);
    assert.match(route, /authoredQuestionType\(q\)/);
    assert.match(route, /upsertByClerkId\(/);
    assert.ok(route.indexOf("upsertByClerkId(") < promptIndex);
  });

  it("assigns the creator and selected students only after the exam id exists", () => {
    const commitIndex = route.indexOf("commitExamCreation");
    const assignIndex = route.indexOf("userRepo.assignExam(");
    const manyIndex = route.indexOf("assignExamToMany(");
    const successIndex = route.indexOf("Exam created successfully");
    assert.ok(commitIndex > -1 && assignIndex > commitIndex && manyIndex > assignIndex && successIndex > manyIndex);
    assert.match(route, /creatorAssigned: allocation\.success/);
    assert.match(route, /runOptionalMongoTransaction/);
  });
});

describe("repository rollback with injected write failures", () => {
  it("deletes partial prompts and exam questions when a later insert fails", () => {
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
      if (key.startsWith("NODE_TEST") || key.startsWith("NODE_CHANNEL")) delete env[key];
    }
    env.mongodb_url = process.env.mongodb_url || "mongodb://127.0.0.1:27017/eesa-exam-create-test";

    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "--test", "tests/node/exam-creation-atomicity.check.ts"],
      { cwd: root, encoding: "utf8", env },
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /rolls back exam questions inserted before the exam insert fails/);
    assert.match(result.stdout, /# fail 0/);
  });
});
