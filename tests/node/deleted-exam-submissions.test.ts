import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { activeExamQuery, isExamDeleted } from "../../packages/backend/src/database/examDeletion.ts";
import {
  examAttemptStartDecision,
  examContentAccessDecision,
} from "../../packages/backend/src/services/examAccess.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

function methodBody(source: string, signature: string): string {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `missing ${signature}`);
  const next = source.indexOf("\n  async ", start + signature.length);
  return source.slice(start, next === -1 ? source.length : next);
}

describe("isExamDeleted", () => {
  it("recognizes a real deletion timestamp", () => {
    assert.equal(isExamDeleted(new Date("2026-10-13T00:00:00.000Z")), true);
    assert.equal(isExamDeleted("2026-10-13T00:00:00.000Z"), true);
    assert.equal(isExamDeleted(Date.parse("2026-10-13T00:00:00.000Z")), true);
  });

  it("ignores missing or unusable values", () => {
    for (const value of [undefined, null, "", "not-a-date", Number.NaN]) {
      assert.equal(isExamDeleted(value), false);
    }
  });
});

describe("active exam listings", () => {
  it("excludes soft-deleted exams while keeping the caller's other filters", () => {
    assert.deepEqual(activeExamQuery({ subject: "os", createdBy: "teacher_1" }), {
      subject: "os",
      createdBy: "teacher_1",
      $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }],
    });
  });
});

describe("deleted exams cannot be started or opened", () => {
  const deletedAt = new Date("2026-10-13T00:00:00.000Z");

  it("refuses an attempt by an assigned student", () => {
    const decision = examAttemptStartDecision({
      callerId: "student_1",
      assignedUsers: ["student_1"],
      deletedAt,
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.status, 404);
    assert.equal(decision.error, "Exam not found");
  });

  it("refuses question content for a student, the creator, and an admin", () => {
    for (const caller of [
      { callerId: "student_1", callerRole: "student" },
      { callerId: "teacher_1", callerRole: "teacher" },
      { callerId: "admin_1", callerRole: "admin" },
    ]) {
      const decision = examContentAccessDecision({
        ...caller,
        assignedUsers: ["teacher_1", "student_1"],
        createdBy: "teacher_1",
        deletedAt,
      });
      assert.equal(decision.allowed, false, caller.callerId);
      assert.equal(decision.status, 404);
      assert.equal(decision.revealAnswerKey, false);
    }
  });

  it("still lets an assigned student start an exam that was not deleted", () => {
    assert.equal(
      examAttemptStartDecision({
        callerId: "student_1",
        assignedUsers: ["student_1"],
        deletedAt: null,
      }).allowed,
      true,
    );
  });

  it("keeps the unauthenticated rejection ahead of the deleted-exam check", () => {
    assert.equal(
      examAttemptStartDecision({
        callerId: null,
        assignedUsers: ["student_1"],
        deletedAt,
      }).status,
      401,
    );
    assert.equal(
      examContentAccessDecision({
        callerId: null,
        assignedUsers: ["student_1"],
        createdBy: "teacher_1",
        deletedAt,
      }).status,
      401,
    );
  });
});

describe("soft delete keeps saved submissions readable", () => {
  it("marks the exam deleted without removing the exam or its questions", () => {
    const source = read("packages/backend/src/database/repositories/ExamRepository.ts");
    const body = methodBody(source, "async delete(");
    assert.match(body, /deletedAt/);
    assert.match(body, /updateOne/);
    assert.doesNotMatch(body, /deleteOne/);
    assert.doesNotMatch(body, /deleteManyByIds/);
    assert.match(body, /currentAllocatedExams/);
  });

  it("hides deleted exams from listing queries and still loads them for historical reads", () => {
    const source = read("packages/backend/src/database/repositories/ExamRepository.ts");
    for (const signature of ["async getByIds(", "async getBySubject(", "async getByCreator(", "async getAll("]) {
      const body = methodBody(source, signature);
      assert.match(body, /activeExamQuery/, signature);
    }
    const byId = methodBody(source, "async getById(");
    const full = methodBody(source, "async getWithFullDetails(");
    assert.doesNotMatch(byId, /activeExamQuery|deletedAt/);
    assert.doesNotMatch(full, /deletedAt/);
  });

  it("still builds GET /api/submissions/[id] from the stored exam join", () => {
    const source = read("packages/frontend/app/api/submissions/[id]/route.ts");
    assert.match(source, /getWithFullDetails\(submission\.examId\)/);
    assert.match(source, /requireSubmissionAccess/);
    assert.doesNotMatch(source, /isExamDeleted|deletedAt/);
  });

  it("wires the deletion flag into the schema, attempt gate, content gate, and new submissions", () => {
    const schema = read("packages/backend/src/database/schemas/examSchemaZod.ts");
    assert.match(schema, /deletedAt:\s*z\.date\(\)\.optional\(\)/);

    const attempt = read("packages/frontend/app/api/exams/[id]/attempt/route.ts");
    assert.match(attempt, /deletedAt:\s*exam\.deletedAt/);

    const auth = read("packages/frontend/lib/requestAuth.ts");
    assert.match(auth, /deletedAt:\s*exam\.deletedAt/);

    const create = read("packages/frontend/app/api/submissions/create/route.ts");
    assert.match(create, /isExamDeleted\(exam\.deletedAt\)/);
    const evaluation = create.indexOf("evaluateExamSubmission(");
    const guard = create.indexOf("isExamDeleted(exam.deletedAt)");
    assert.ok(guard > -1 && evaluation > guard);
  });
});
