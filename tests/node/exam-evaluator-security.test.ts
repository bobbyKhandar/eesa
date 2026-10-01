import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  adminAccessDecision,
  examContentAccessDecision,
  resolveSelfServiceRole,
  selfUserWriteDecision,
  submissionAccessDecision,
  toExamineeExam,
} from "../../packages/backend/src/services/examAccess.ts";
import {
  buildStoredQuestionOptions,
  correctOptionTexts,
  normalizeMcqResponse,
  presentSubmissionQuestion,
} from "../../packages/backend/src/services/mcqAlignment.ts";
import { evaluateExamSubmission } from "../../packages/backend/src/services/examEvaluationService.ts";

const mcqQuestion = {
  _id: "q1",
  questionType: "MCQ",
  marks: 5,
  negativeMarks: 1,
  promptData: { questionText: "Pick a color" },
  options: [
    { text: "Red", isCorrect: false },
    { text: "Green", isCorrect: true },
    { text: "Blue", isCorrect: false },
  ],
  answer: [1],
};

describe("admin authorization", () => {
  it("rejects unauthenticated truncate callers", () => {
    const decision = adminAccessDecision({ callerId: null, callerRole: null });
    assert.equal(decision.allowed, false);
    assert.equal(decision.status, 401);
  });

  it("rejects authenticated non-admins", () => {
    const decision = adminAccessDecision({ callerId: "user_1", callerRole: "student" });
    assert.equal(decision.allowed, false);
    assert.equal(decision.status, 403);
  });

  it("allows authenticated admins", () => {
    const decision = adminAccessDecision({ callerId: "admin_1", callerRole: "admin" });
    assert.equal(decision.allowed, true);
    assert.equal(decision.status, 200);
  });

  it("never lets a self-service profile write grant admin", () => {
    assert.equal(resolveSelfServiceRole("admin"), "student");
    assert.equal(resolveSelfServiceRole("teacher"), "student");
    const write = selfUserWriteDecision(null, "user_1");
    assert.equal(write.allowed, false);
    assert.equal(write.status, 401);
    assert.equal(selfUserWriteDecision("user_1", "user_2").status, 403);
    assert.equal(selfUserWriteDecision("user_1", "user_1").allowed, true);
  });
});

describe("exam question access and answer keys", () => {
  const exam = {
    _id: "exam_1",
    examTitle: "Colors",
    createdBy: "teacher_1",
    assignedUsers: ["student_1"],
    questionDetails: [mcqQuestion],
    answer: "should-not-leak",
  };

  it("blocks unauthenticated question reads", () => {
    const decision = examContentAccessDecision({
      callerId: null,
      assignedUsers: exam.assignedUsers,
      createdBy: exam.createdBy,
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.status, 401);
  });

  it("blocks authenticated users who are not assigned, creator, or admin", () => {
    const decision = examContentAccessDecision({
      callerId: "stranger",
      callerRole: "student",
      assignedUsers: exam.assignedUsers,
      createdBy: exam.createdBy,
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.status, 403);
  });

  it("allows an assigned examinee without revealing the answer key", () => {
    const decision = examContentAccessDecision({
      callerId: "student_1",
      callerRole: "student",
      assignedUsers: exam.assignedUsers,
      createdBy: exam.createdBy,
    });
    assert.equal(decision.allowed, true);
    assert.equal(decision.revealAnswerKey, false);
  });

  it("strips answer keys and isCorrect from the examinee exam payload", () => {
    const payload = toExamineeExam(exam);
    const serialized = JSON.stringify(payload);
    assert.equal(serialized.includes("isCorrect"), false);
    assert.equal(serialized.includes("Green"), true);
    assert.equal(serialized.includes('"answer"'), false);
    assert.equal(payload.questionDetails, undefined);
    assert.equal(payload.questions[0].options[1].text, "Green");
    assert.equal("isCorrect" in payload.questions[0].options[1], false);
    assert.equal(payload.questions[0].marks, 5);
  });
});

describe("submission IDOR", () => {
  it("requires authentication", () => {
    const decision = submissionAccessDecision({
      callerId: null,
      submissionUserId: "student_1",
    });
    assert.equal(decision.status, 401);
  });

  it("denies a different user", () => {
    const decision = submissionAccessDecision({
      callerId: "student_2",
      callerRole: "student",
      submissionUserId: "student_1",
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.status, 403);
  });

  it("allows the owner and an admin", () => {
    assert.equal(
      submissionAccessDecision({
        callerId: "student_1",
        callerRole: "student",
        submissionUserId: "student_1",
      }).allowed,
      true
    );
    assert.equal(
      submissionAccessDecision({
        callerId: "admin_1",
        callerRole: "admin",
        submissionUserId: "student_1",
      }).allowed,
      true
    );
  });
});

describe("server-side maxMarks and MCQ alignment", () => {
  it("treats an option index and the same option text as the same answer", () => {
    const byIndex = normalizeMcqResponse("1", mcqQuestion.options);
    const byText = normalizeMcqResponse("Green", mcqQuestion.options);
    assert.equal(byIndex.text, "Green");
    assert.equal(byIndex.index, 1);
    assert.deepEqual(byIndex, byText);
    assert.deepEqual(correctOptionTexts(mcqQuestion), ["Green"]);
  });

  it("stores the selected correctOption index and isCorrect flag on the same option", () => {
    const stored = buildStoredQuestionOptions({
      options: ["Red", "Green", "Blue"],
      correctOption: 1,
    });
    assert.deepEqual(stored.answer, [1]);
    assert.equal(stored.options[1].isCorrect, true);
    assert.equal(stored.options[0].isCorrect, false);
    assert.equal(normalizeMcqResponse("1", stored.options).text, "Green");
    assert.deepEqual(correctOptionTexts({ options: stored.options, answer: stored.answer }), ["Green"]);
  });

  it("grades index and text identically and ignores client maxMarks", async () => {
    const questions = [mcqQuestion, { ...mcqQuestion, _id: "q2", marks: 10, options: [{ text: "Yes", isCorrect: true }], answer: [0] }];
    const gradedFromIndex = await evaluateExamSubmission(questions, [
      { questionId: "q1", userResponse: "1", maxMarks: 999 },
      { questionId: "q2", userResponse: "0", maxMarks: 999 },
    ]);
    const gradedFromText = await evaluateExamSubmission(questions, [
      { questionId: "q1", userResponse: "Green", maxMarks: 1 },
      { questionId: "q2", userResponse: "Yes", maxMarks: 1 },
    ]);

    assert.equal("error" in gradedFromIndex, false);
    if ("error" in gradedFromIndex || "error" in gradedFromText) {
      assert.fail("evaluation should succeed");
    }
    assert.equal(gradedFromIndex.maxMarks, 15);
    assert.equal(gradedFromText.maxMarks, 15);
    assert.equal(gradedFromIndex.marksAchieved, gradedFromText.marksAchieved);
    assert.equal(gradedFromIndex.responses[0].userResponse, "Green");
    assert.equal(gradedFromIndex.responses[0].maxMarks, 5);
    assert.equal(gradedFromIndex.responses[0].allottedMarks, 5);
    assert.equal(gradedFromIndex.responses[1].maxMarks, 10);
  });

  it("does not award a wrong index the marks of the matching text", async () => {
    const result = await evaluateExamSubmission([mcqQuestion], [
      { questionId: "q1", userResponse: "0", maxMarks: 100 },
    ]);
    if ("error" in result) assert.fail(result.error);
    assert.equal(result.responses[0].userResponse, "Red");
    assert.equal(result.responses[0].allottedMarks, -1);
    assert.equal(result.maxMarks, 5);
    assert.equal(result.marksAchieved, -1);
  });

  it("rejects a response for a question that is not on the exam", async () => {
    const result = await evaluateExamSubmission([mcqQuestion], [
      { questionId: "missing", userResponse: "Green", maxMarks: 5 },
    ]);
    assert.equal("error" in result, true);
  });

  it("presents stored indexes as option text next to the correct option text", () => {
    const presented = presentSubmissionQuestion(mcqQuestion, {
      questionId: "q1",
      userResponse: "1",
      maxMarks: 999,
      allottedMarks: 5,
      feedback: "ok",
    });
    assert.equal(presented.type, "mcq");
    assert.deepEqual(presented.options, ["Red", "Green", "Blue"]);
    assert.equal(presented.correctAnswer, "Green");
    assert.equal(presented.userResponse.userResponse, "Green");
    assert.equal(presented.maxScore, 5);
    assert.equal(JSON.stringify(presented).includes("isCorrect"), false);
  });

  it("sends theory answers through the evaluation service with server max marks", async () => {
    let seenMax = -1;
    const theory = {
      _id: "t1",
      questionType: "TEXT",
      marks: 8,
      promptData: { questionText: "Explain virtual memory" },
      answer: "Paging to disk",
    };
    const result = await evaluateExamSubmission(
      [theory],
      [{ questionId: "t1", userResponse: "It uses disk", maxMarks: 1000 }],
      {
        gradeText: async (input) => {
          seenMax = input.maxMarks;
          return { allottedMarks: 4, feedback: "partial", suggestions: ["Add examples"] };
        },
      }
    );
    if ("error" in result) assert.fail(result.error);
    assert.equal(seenMax, 8);
    assert.equal(result.maxMarks, 8);
    assert.equal(result.responses[0].allottedMarks, 4);
    assert.equal(result.responses[0].maxMarks, 8);
    assert.deepEqual(result.responses[0].suggestions, ["Add examples"]);
  });
});
