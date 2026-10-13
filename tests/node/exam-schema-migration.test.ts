import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { examQuestionZodSchema } from "../../packages/backend/src/database/schemas/examQuestionSchemaZod.ts";
import {
  buildExamQuestionPayload,
  formatMigrationReport,
  migrationExitCode,
  migratedExamQuestionId,
  planExamConversion,
  type LegacyQuestionSource,
  type PromptLink,
} from "../../packages/backend/src/database/examSchemaMigration.ts";

const root = new URL("../..", import.meta.url);

function readRepoFile(relativePath: string): string {
  return readFileSync(new URL(relativePath, root), "utf8");
}

const mcqQuestion: LegacyQuestionSource = {
  text: "Which planet is red?",
  type: "mcq",
  options: ["Venus", "Mars", "Jupiter"],
  answer: "Mars",
};

const theoryQuestion: LegacyQuestionSource = {
  text: "Explain photosynthesis.",
  type: "theory",
  options: [],
  answer: "Plants convert light into chemical energy.",
};

function links(): Map<string, PromptLink> {
  return new Map<string, PromptLink>([
    ["q-mcq", { promptId: "prompt-mcq", question: mcqQuestion }],
    ["q-theory", { promptId: "prompt-theory", question: theoryQuestion }],
  ]);
}

describe("buildExamQuestionPayload", () => {
  it("maps a legacy mcq onto questionType, options, answer, and marks", () => {
    const payload = buildExamQuestionPayload({
      promptId: "prompt-mcq",
      marks: 5,
      negativeMarking: true,
      negativeMarkingPercentage: 20,
      legacyQuestion: mcqQuestion,
    });

    assert.equal(payload.questionType, "MCQ");
    assert.equal("answerType" in payload, false);
    assert.equal(payload.marks, 5);
    assert.equal(payload.negativeMarks, 1);
    assert.deepEqual(payload.options, [
      { text: "Venus", isCorrect: false },
      { text: "Mars", isCorrect: true },
      { text: "Jupiter", isCorrect: false },
    ]);
    assert.deepEqual(payload.answer, [1]);
    assert.equal(examQuestionZodSchema.safeParse(payload).success, true);
  });

  it("rejects the old answerType payload that the migration used to save", () => {
    const parsed = examQuestionZodSchema.safeParse({
      promptId: "prompt-mcq",
      marks: 1,
      negativeMarks: 0,
      answerType: "mcq",
      options: [],
    });
    assert.equal(parsed.success, false);
  });

  it("maps theory questions to TEXT and keeps the written answer", () => {
    const payload = buildExamQuestionPayload({
      promptId: "prompt-theory",
      marks: 8,
      negativeMarking: false,
      legacyQuestion: theoryQuestion,
    });

    assert.equal(payload.questionType, "TEXT");
    assert.equal(payload.answer, "Plants convert light into chemical energy.");
    assert.equal(payload.options, undefined);
    assert.equal(payload.negativeMarks, 0);
    assert.equal(examQuestionZodSchema.safeParse(payload).success, true);
  });

  it("does not store the legacy NOT PRESENT sentinel as a model answer", () => {
    const payload = buildExamQuestionPayload({
      promptId: "prompt-theory",
      marks: 2,
      legacyQuestion: { type: "theory", answer: "NOT PRESENT", options: [] },
    });

    assert.equal(payload.questionType, "TEXT");
    assert.equal(payload.answer, "");
  });

  it("maps true/false questions and a numeric option index", () => {
    const payload = buildExamQuestionPayload({
      promptId: "prompt-tf",
      marks: 1,
      legacyQuestion: {
        type: "true_false",
        options: ["True", "False"],
        answer: "1",
      },
    });

    assert.equal(payload.questionType, "TRUE_FALSE");
    assert.deepEqual(payload.options, [
      { text: "True", isCorrect: false },
      { text: "False", isCorrect: true },
    ]);
    assert.deepEqual(payload.answer, [1]);
  });

  it("keeps a zero mark and defaults missing marks to 1", () => {
    const zero = buildExamQuestionPayload({
      promptId: "prompt-theory",
      marks: 0,
      legacyQuestion: theoryQuestion,
    });
    const missing = buildExamQuestionPayload({
      promptId: "prompt-theory",
      marks: undefined,
      legacyQuestion: theoryQuestion,
    });

    assert.equal(zero.marks, 0);
    assert.equal(missing.marks, 1);
  });

  it("uses a 25 percent deduction when negative marking has no percentage", () => {
    const payload = buildExamQuestionPayload({
      promptId: "prompt-mcq",
      marks: 4,
      negativeMarking: true,
      legacyQuestion: mcqQuestion,
    });
    assert.equal(payload.negativeMarks, 1);
  });

  it("reads options stored on the embedded exam entry when the question bank has none", () => {
    const payload = buildExamQuestionPayload({
      promptId: "prompt-mcq",
      marks: 3,
      legacyQuestion: { type: "mcq", options: [], answer: "Blue" },
      embedded: { options: ["Red", "Blue"], answer: "Blue" },
    });

    assert.deepEqual(payload.options, [
      { text: "Red", isCorrect: false },
      { text: "Blue", isCorrect: true },
    ]);
    assert.deepEqual(payload.answer, [1]);
  });
});

describe("planExamConversion", () => {
  const legacyExam = {
    _id: "exam-1",
    negativeMarking: false,
    assignedUsers: ["student-1"],
    createdBy: "teacher-1",
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    deletedAt: new Date("2026-10-01T00:00:00.000Z"),
    questions: [
      { questionId: "q-mcq", marks: 5 },
      { questionId: "q-theory", marks: 8 },
    ],
  };

  it("converts every legacy question and only schedules a questions-field update", () => {
    const plan = planExamConversion(legacyExam, links());

    assert.equal(plan.status, "convert");
    assert.equal(plan.questions?.length, 2);
    assert.deepEqual(
      plan.questions?.map((question) => question.data.questionType),
      ["MCQ", "TEXT"]
    );
    assert.deepEqual(plan.examUpdate, {
      questions: plan.questions?.map((question) => question.id),
    });
    assert.equal(Object.hasOwn(plan.examUpdate ?? {}, "assignedUsers"), false);
    assert.equal(Object.hasOwn(plan.examUpdate ?? {}, "createdBy"), false);
    assert.equal(Object.hasOwn(plan.examUpdate ?? {}, "createdAt"), false);
    assert.equal(Object.hasOwn(plan.examUpdate ?? {}, "deletedAt"), false);
    for (const question of plan.questions ?? []) {
      assert.equal(examQuestionZodSchema.safeParse(question.data).success, true);
    }
  });

  it("uses stable ids so a re-run upserts the same ExamQuestion documents", () => {
    const first = planExamConversion(legacyExam, links());
    const second = planExamConversion(legacyExam, links());
    assert.deepEqual(
      first.questions?.map((question) => question.id),
      second.questions?.map((question) => question.id)
    );
    assert.equal(first.questions?.[0].id, migratedExamQuestionId("exam-1", "q-mcq", 0));
    assert.notEqual(first.questions?.[0].id, first.questions?.[1].id);
  });

  it("leaves an already migrated exam, including a soft-deleted one, unchanged", () => {
    const converted = planExamConversion(legacyExam, links());
    const migrated = planExamConversion(
      {
        ...legacyExam,
        questions: converted.examUpdate?.questions,
      },
      links()
    );

    assert.equal(migrated.status, "skip-migrated");
    assert.equal(migrated.examUpdate, undefined);
    assert.equal(migrated.questions, undefined);
  });

  it("does not rewrite an exam when a prompt or question is missing", () => {
    const plan = planExamConversion(legacyExam, new Map());
    assert.equal(plan.status, "failed");
    assert.match(plan.error ?? "", /q-mcq/);
    assert.equal(plan.examUpdate, undefined);
  });

  it("does not rewrite a mix of legacy entries and ExamQuestion ids", () => {
    const plan = planExamConversion(
      {
        ...legacyExam,
        questions: ["already-migrated-id", { questionId: "q-theory", marks: 8 }],
      },
      links()
    );
    assert.equal(plan.status, "failed");
    assert.equal(plan.examUpdate, undefined);
  });

  it("skips an exam that has no questions", () => {
    const plan = planExamConversion({ ...legacyExam, questions: [] }, links());
    assert.equal(plan.status, "skip-empty");
    assert.equal(plan.examUpdate, undefined);
  });

  it("treats ObjectId question references as already migrated", () => {
    const plan = planExamConversion(
      {
        ...legacyExam,
        questions: [{ _bsontype: "ObjectId", toHexString: () => "a".repeat(24) }],
      },
      links()
    );
    assert.equal(plan.status, "skip-migrated");
  });

  it("simulates an idempotent apply that preserves exam metadata", () => {
    const stored = new Map<string, unknown>();
    const exam = {
      ...legacyExam,
      questions: legacyExam.questions.map((question) => ({ ...question })),
    };

    const apply = () => {
      const plan = planExamConversion(exam, links());
      if (plan.status !== "convert" || !plan.examUpdate) return plan;
      for (const question of plan.questions ?? []) stored.set(question.id, question.data);
      exam.questions = plan.examUpdate.questions.map((id) => id) as typeof exam.questions;
      return plan;
    };

    const first = apply();
    const sizeAfterFirst = stored.size;
    const second = apply();

    assert.equal(first.status, "convert");
    assert.equal(second.status, "skip-migrated");
    assert.equal(stored.size, sizeAfterFirst);
    assert.equal(stored.size, 2);
    assert.deepEqual(exam.assignedUsers, ["student-1"]);
    assert.equal(exam.createdBy, "teacher-1");
    assert.deepEqual(exam.deletedAt, legacyExam.deletedAt);
    assert.deepEqual(exam.questions, first.examUpdate?.questions);
  });
});

describe("migration result", () => {
  it("exits successfully only when every exam conversion succeeded", () => {
    assert.equal(migrationExitCode([]), 0);
    assert.equal(
      migrationExitCode([{ step: "exam-questions", id: "exam-1", error: "validation failed" }]),
      1
    );

    const success = formatMigrationReport([], false).join("\n");
    const failure = formatMigrationReport(
      [{ step: "exam-questions", id: "exam-1", error: "Question q-mcq does not match the ExamQuestion schema" }],
      false
    ).join("\n");

    assert.match(success, /completed/i);
    assert.match(failure, /failed/i);
    assert.doesNotMatch(failure, /Migration completed/);
    assert.match(failure, /exam-1/);
    assert.match(failure, /not rewritten/i);
  });
});

describe("migrate-schema script", () => {
  const source = readRepoFile("packages/backend/src/database/scripts/migrate-schema.ts");

  it("plans ExamQuestion documents and fails the run when any exam cannot be converted", () => {
    assert.match(source, /planExamConversion/);
    assert.match(source, /migrationExitCode/);
    assert.equal(source.includes("answerType"), false);
    assert.equal(source.includes("assignedUsers: []"), false);
    assert.equal(source.includes("createdBy: 'system'"), false);
    assert.match(source, /\{\s*\$set:\s*\{\s*questions:/);
  });
});
