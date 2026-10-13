import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  confirmedStudentAssignees,
  dedupeExamUserIds,
  examUsersForCreation,
  filterAssignableStudents,
  findMissingStudentAssignees,
  listAssignableStudents,
  MISSING_STUDENT_ASSIGNEES,
  toAssignableStudent,
} from "../../packages/frontend/lib/examCreation.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("assignable student directory", () => {
  const student = {
    _id: "student_1",
    email: "ada@school.edu",
    name: "Ada",
    role: "student",
    status: "active",
  };

  it("keeps an active student", () => {
    assert.deepEqual(toAssignableStudent(student), {
      id: "student_1",
      name: "Ada",
      email: "ada@school.edu",
    });
  });

  it("treats a missing status as active and falls back to email when the name is blank", () => {
    assert.deepEqual(toAssignableStudent({ ...student, name: "  ", status: undefined }), {
      id: "student_1",
      name: "ada@school.edu",
      email: "ada@school.edu",
    });
  });

  it("drops teachers, admins, inactive accounts, and rows without an id or email", () => {
    assert.equal(toAssignableStudent({ ...student, role: "teacher" }), null);
    assert.equal(toAssignableStudent({ ...student, role: "admin" }), null);
    assert.equal(toAssignableStudent({ ...student, status: "suspended" }), null);
    assert.equal(toAssignableStudent({ ...student, status: "inactive" }), null);
    assert.equal(toAssignableStudent({ ...student, email: "" }), null);
    assert.equal(toAssignableStudent({ ...student, _id: "" }), null);
    assert.equal(toAssignableStudent(null), null);
  });

  it("lists each student once and omits the exam creator", () => {
    assert.deepEqual(
      listAssignableStudents([student, student, { ...student, _id: "creator", email: "me@school.edu" }], "creator"),
      [{ id: "student_1", name: "Ada", email: "ada@school.edu" }],
    );
  });

  it("filters the roster by name or email", () => {
    const rows = listAssignableStudents([
      student,
      { _id: "student_2", email: "grace@school.edu", name: "Grace", role: "student" },
    ]);
    assert.deepEqual(filterAssignableStudents(rows, "gra").map((row) => row.id), ["student_2"]);
    assert.deepEqual(filterAssignableStudents(rows, "  ").map((row) => row.id), ["student_1", "student_2"]);
  });
});

describe("teacher exam assignees", () => {
  it("sends only the selected students for a teacher exam", () => {
    assert.deepEqual(examUsersForCreation("teacher", [" student_1 ", "student_1", "", "student_2"]), [
      "student_1",
      "student_2",
    ]);
  });

  it("does not attach a roster to a personal exam", () => {
    assert.deepEqual(examUsersForCreation("personal", ["student_1"]), []);
    assert.deepEqual(examUsersForCreation(null, ["student_1"]), []);
  });

  it("dedupes raw exam user ids and ignores non-strings", () => {
    assert.deepEqual(dedupeExamUserIds([" student_1 ", "student_1", "", 7, null, "student_2"]), [
      "student_1",
      "student_2",
    ]);
    assert.deepEqual(dedupeExamUserIds(undefined), []);
  });

  it("requires at least one student only for a teacher exam", () => {
    assert.equal(findMissingStudentAssignees("teacher", []), MISSING_STUDENT_ASSIGNEES);
    assert.equal(findMissingStudentAssignees("teacher", ["student_1"]), null);
    assert.equal(findMissingStudentAssignees("personal", []), null);
  });

  it("keeps requested ids that are active students other than the creator", () => {
    const directory = [
      { _id: "student_1", email: "ada@school.edu", name: "Ada", role: "student", status: "active" },
      { _id: "student_2", email: "grace@school.edu", name: "Grace", role: "student", status: "suspended" },
      { _id: "teacher_1", email: "me@school.edu", name: "Mina", role: "teacher" },
      { _id: "creator", email: "me2@school.edu", name: "Creator", role: "student" },
    ];
    assert.deepEqual(
      confirmedStudentAssignees(["student_1", "student_2", "teacher_1", "creator", "missing"], directory, "creator"),
      ["student_1"],
    );
  });
});

describe("exam creation assigns selected students", () => {
  it("submits the selected student ids instead of an empty examUsers list", () => {
    const source = read("packages/frontend/app/dashboard/exams/create/page.tsx");
    assert.doesNotMatch(source, /examUsers:\s*\[\s*\]/);
    assert.match(source, /selectedStudentIds/);
    assert.match(source, /findMissingStudentAssignees/);
    // #86: a teacher deadline still becomes scheduledAt and is not dropped.
    assert.match(source, /scheduledAt:\s*deadline \? new Date\(deadline\)\.toISOString\(\) : undefined/);
  });

  it("rejects a teacher exam that has no confirmed students before prompts are created", () => {
    const source = read("packages/frontend/app/api/exams/create/route.ts");
    const guardIndex = source.indexOf("findMissingStudentAssignees(");
    const promptIndex = source.indexOf("promptRepo.createBulk(");
    assert.ok(guardIndex > -1 && promptIndex > guardIndex);

    const assignIndex = source.indexOf("assignExamToMany(");
    const responseIndex = source.indexOf("Exam created successfully");
    assert.ok(assignIndex > -1 && responseIndex > assignIndex);

    // #86: schedule parsing stays on the create path.
    assert.match(source, /scheduledAt:\s*parsedScheduledAt/);
  });

  it("lists students for the recipient selector without opening the admin user API", () => {
    const source = read("packages/frontend/app/api/users/students/route.ts");
    assert.match(source, /listAssignableStudents/);
    assert.match(source, /userRepo\.getStudents/);
    assert.doesNotMatch(source, /resolveIsAdmin/);
  });
});
