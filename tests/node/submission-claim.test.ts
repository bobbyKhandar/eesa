import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  claimSubmissionSlot,
  gradedSubmissionFilter,
  gradedSubmissionUpdate,
  isDuplicateKeyError,
  isVisibleSubmission,
  pendingClaimFilter,
  submitExamAfterWindow,
  type SubmissionClaimStore,
} from "../../packages/backend/src/services/examSubmissionClaim.ts";
import { submissionConflictOutcome } from "../../packages/frontend/lib/examResults.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

const graded = {
  responses: [
    {
      questionId: "q1",
      userResponse: "Mars",
      maxMarks: 5,
      allottedMarks: 4,
      feedback: "Correct planet",
      suggestions: ["Name the mission"],
    },
  ],
  marksAchieved: 4,
  maxMarks: 5,
};

interface MemoryDoc {
  _id: string;
  examId: string;
  userId: string;
  gradingStatus?: "pending" | "complete";
  answers?: Record<string, string>;
  responses?: unknown[];
  marksAchieved?: number;
  maxMarks?: number;
}

/**
 * In-memory stand-in for the unique (examId, userId) index.
 * Inserts are serialized the way Mongo serializes a unique index, so two
 * in-flight claims cannot both land a row.
 */
function memoryStore(seed: MemoryDoc[] = []): SubmissionClaimStore & {
  docs: MemoryDoc[];
  complete(id: string): Promise<{ success: boolean; error?: string }>;
  release(id: string): Promise<void>;
} {
  const docs = seed.map((doc) => ({ ...doc }));
  let chain: Promise<void> = Promise.resolve();
  const exclusive = <T>(fn: () => T): Promise<T> => {
    const run = chain.then(fn);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  return {
    docs,
    insertPending() {
      return exclusive(() => {
        const examId = "exam-1";
        const userId = "user-1";
        if (docs.some((doc) => doc.examId === examId && doc.userId === userId)) {
          throw Object.assign(new Error("E11000 duplicate key error collection: examSubmissions index: examId_1_userId_1"), {
            code: 11000,
          });
        }
        const submissionId = `sub-${docs.length + 1}`;
        docs.push({ _id: submissionId, examId, userId, gradingStatus: "pending", responses: [] });
        return submissionId;
      });
    },
    findByExamAndUser() {
      return Promise.resolve(docs.find((doc) => doc.examId === "exam-1" && doc.userId === "user-1") ?? null);
    },
    complete(id: string) {
      return exclusive(() => {
        const doc = docs.find((entry) => entry._id === id && entry.gradingStatus === "pending");
        if (!doc) return { success: false, error: "Pending submission was not found" };
        const update = gradedSubmissionUpdate(graded);
        assert.equal(Object.hasOwn(update.$set, "answers"), false);
        assert.equal(Object.hasOwn(update, "$unset"), false);
        Object.assign(doc, update.$set);
        return { success: true };
      });
    },
    release(id: string) {
      return exclusive(() => {
        const filter = pendingClaimFilter(id);
        const index = docs.findIndex(
          (doc) => doc._id === filter._id && doc.gradingStatus === filter.gradingStatus,
        );
        if (index >= 0) docs.splice(index, 1);
      });
    },
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for the in-flight claim");
}

describe("isDuplicateKeyError", () => {
  it("recognizes a unique-index failure from Mongo and from a bulk write", () => {
    assert.equal(isDuplicateKeyError(Object.assign(new Error("E11000 duplicate key"), { code: 11000 })), true);
    assert.equal(isDuplicateKeyError({ writeErrors: [{ code: 11000 }] }), true);
    assert.equal(isDuplicateKeyError(new Error("connection reset")), false);
    assert.equal(isDuplicateKeyError(null), false);
  });
});

describe("submission visibility", () => {
  it("hides an in-flight claim and keeps legacy rows that have no status", () => {
    assert.equal(isVisibleSubmission({ gradingStatus: "pending" }), false);
    assert.equal(isVisibleSubmission({ gradingStatus: "complete" }), true);
    assert.equal(isVisibleSubmission({}), true);
    assert.deepEqual(gradedSubmissionFilter({ examId: "exam-1", userId: "user-1" }), {
      examId: "exam-1",
      userId: "user-1",
      gradingStatus: { $ne: "pending" },
    });
  });
});

describe("submissionConflictOutcome", () => {
  it("returns the finished submission as a 409 the client can open", () => {
    assert.deepEqual(submissionConflictOutcome({ _id: "legacy-1" }), {
      status: 409,
      error: "You have already submitted this exam",
      submissionId: "legacy-1",
    });
  });

  it("does not hand the client a pending claim id", () => {
    assert.deepEqual(submissionConflictOutcome({ _id: "pending-1", gradingStatus: "pending" }), {
      status: 409,
      error: "This exam submission is already being graded",
    });
  });
});

describe("gradedSubmissionUpdate", () => {
  it("writes scores onto the claim and leaves a legacy answers map untouched", () => {
    const update = gradedSubmissionUpdate(graded);
    const stored = {
      gradingStatus: "pending" as const,
      answers: { q1: "Mars" },
      responses: [] as unknown[],
      marksAchieved: 0,
      maxMarks: 0,
    };
    Object.assign(stored, update.$set);
    assert.equal(stored.gradingStatus, "complete");
    assert.equal(stored.marksAchieved, 4);
    assert.deepEqual(stored.answers, { q1: "Mars" });
    assert.deepEqual(stored.responses, graded.responses);
    assert.equal(Object.hasOwn(update, "$unset"), false);
  });
});

describe("claimSubmissionSlot", () => {
  it("lets only one of two concurrent claims insert a row", async () => {
    const store = memoryStore();
    const [first, second] = await Promise.all([claimSubmissionSlot(store), claimSubmissionSlot(store)]);
    const statuses = [first.status, second.status].sort();
    assert.deepEqual(statuses, ["claimed", "in_progress"]);
    assert.equal(store.docs.length, 1);
    assert.equal(store.docs[0].gradingStatus, "pending");
  });

  it("returns a legacy submission instead of treating a missing status as pending", async () => {
    const store = memoryStore([
      { _id: "legacy-1", examId: "exam-1", userId: "user-1", answers: { q1: "Mars" } },
    ]);
    let grades = 0;
    const result = await submitExamAfterWindow({
      claim: () => claimSubmissionSlot(store),
      grade: async () => {
        grades += 1;
        return graded;
      },
      complete: (id) => store.complete(id),
      release: (id) => store.release(id),
    });
    assert.equal(result.status, "duplicate");
    if (result.status === "duplicate") {
      assert.equal(String(result.submission._id), "legacy-1");
    }
    assert.equal(grades, 0);
    assert.deepEqual(store.docs[0].answers, { q1: "Mars" });
  });

  it("claims again when the conflicting row was released before it could be read", async () => {
    let inserts = 0;
    const store: SubmissionClaimStore = {
      async insertPending() {
        inserts += 1;
        if (inserts === 1) {
          throw Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
        }
        return "sub-retry";
      },
      async findByExamAndUser() {
        return null;
      },
    };
    const result = await claimSubmissionSlot(store);
    assert.deepEqual(result, { status: "claimed", submissionId: "sub-retry" });
  });

  it("reports an in-progress conflict when the duplicate row cannot be read", async () => {
    const store: SubmissionClaimStore = {
      async insertPending() {
        throw Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
      },
      async findByExamAndUser() {
        return null;
      },
    };
    const result = await claimSubmissionSlot(store);
    assert.equal(result.status, "in_progress");
  });
});

describe("submitExamAfterWindow", () => {
  it("grades once when two submissions race the same exam", async () => {
    const store = memoryStore();
    let grades = 0;
    let releaseGrade: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseGrade = resolve;
    });

    const submit = () =>
      submitExamAfterWindow({
        claim: () => claimSubmissionSlot(store),
        grade: async () => {
          grades += 1;
          await gate;
          return graded;
        },
        complete: (id) => store.complete(id),
        release: (id) => store.release(id),
      });

    const first = submit();
    await waitFor(() => grades === 1);
    const second = await submit();
    assert.equal(second.status, "in_progress");
    assert.equal(grades, 1);

    releaseGrade();
    const winner = await first;
    assert.equal(winner.status, "submitted");
    if (winner.status === "submitted") {
      assert.equal(winner.totalMarks, 4);
      assert.equal(winner.maxTotalMarks, 5);
    }
    assert.equal(grades, 1);
    assert.equal(store.docs.length, 1);
    assert.equal(store.docs[0].gradingStatus, "complete");
    assert.equal(store.docs[0].marksAchieved, 4);
  });

  it("drops the claim when grading fails so a later submit can grade", async () => {
    const store = memoryStore();
    let grades = 0;
    const submit = () =>
      submitExamAfterWindow({
        claim: () => claimSubmissionSlot(store),
        grade: async () => {
          grades += 1;
          if (grades === 1) return { error: "The response could not be graded" };
          return graded;
        },
        complete: (id) => store.complete(id),
        release: (id) => store.release(id),
      });

    const failed = await submit();
    assert.deepEqual(failed, { status: "invalid", error: "The response could not be graded" });
    assert.equal(store.docs.length, 0);

    const retried = await submit();
    assert.equal(retried.status, "submitted");
    assert.equal(grades, 2);
    assert.equal(store.docs.length, 1);
    assert.equal(store.docs[0].gradingStatus, "complete");
  });

  it("drops the claim when grading throws so the unique index does not stick", async () => {
    const store = memoryStore();
    await assert.rejects(
      () =>
        submitExamAfterWindow({
          claim: () => claimSubmissionSlot(store),
          grade: async () => {
            throw new Error("gemini unavailable");
          },
          complete: (id) => store.complete(id),
          release: (id) => store.release(id),
        }),
      /gemini unavailable/,
    );
    assert.equal(store.docs.length, 0);

    const retried = await submitExamAfterWindow({
      claim: () => claimSubmissionSlot(store),
      grade: async () => graded,
      complete: (id) => store.complete(id),
      release: (id) => store.release(id),
    });
    assert.equal(retried.status, "submitted");
  });

  it("does not delete a finished submission when release runs after completion", async () => {
    const store = memoryStore();
    const claimed = await claimSubmissionSlot(store);
    assert.equal(claimed.status, "claimed");
    if (claimed.status !== "claimed") return;
    store.docs[0].answers = { q1: "Mars" };
    const saved = await store.complete(claimed.submissionId);
    assert.equal(saved.success, true);
    await store.release(claimed.submissionId);
    assert.equal(store.docs.length, 1);
    assert.equal(store.docs[0].gradingStatus, "complete");
    assert.deepEqual(store.docs[0].answers, { q1: "Mars" });
  });
});

describe("submit route claims before grading", () => {
  it("keeps the deleted-exam rejection ahead of the claim and grades only after the claim", () => {
    const source = read("packages/frontend/app/api/submissions/create/route.ts");
    const deleted = source.indexOf("isExamDeleted(exam.deletedAt)");
    const existing = source.indexOf("getByExamAndUser(");
    const windowCheck = source.indexOf("attemptWindowDecision(");
    const claim = source.indexOf("claimPending(");
    const evaluation = source.indexOf("evaluateExamSubmission(");
    assert.ok(deleted > -1 && existing > deleted);
    assert.ok(windowCheck > existing && claim > windowCheck && evaluation > claim);
    assert.equal(source.indexOf("evaluateExamSubmission(", evaluation + 1), -1);
    assert.match(source, /releasePending\(/);
    assert.match(source, /submissionConflictOutcome\(/);
    assert.doesNotMatch(source, /submissionRepo\.create\(/);
  });

  it("wires the repository claim through the unique index and preserves answers on the grade write", () => {
    const repository = read("packages/backend/src/database/repositories/ExamSubmissionRepository.ts");
    assert.match(repository, /claimSubmissionSlot\(/);
    assert.match(repository, /gradingStatus:\s*"pending"/);
    assert.match(repository, /gradedSubmissionUpdate\(/);
    assert.match(repository, /pendingClaimFilter\(/);
    assert.match(repository, /isDuplicateKeyError\(/);
    assert.match(repository, /gradedSubmissionFilter\(/);
    assert.match(repository, /isVisibleSubmission\(/);
    const schema = read("packages/backend/src/database/schemas/examSubmissionZod.ts");
    assert.match(schema, /gradingStatus:\s*z\.enum\(\["pending", "complete"\]\)\.default\("complete"\)/);
  });
});
