import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  appendChoice,
  authoredQuestionType,
  authoringKind,
  createQuestionDraft,
  findInvalidQuestion,
  mergeQuestionUpdate,
  nextQuestionId,
  removeChoice,
  replaceChoice,
  toCreateExamQuestions,
  withQuestionType,
  type ExamQuestionDraft,
} from "../../packages/frontend/lib/examCreation.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("authored question types", () => {
  it("recognizes theory, multiple choice, and true/false aliases", () => {
    assert.equal(authoredQuestionType({ questionType: "TEXT" }), "TEXT");
    assert.equal(authoredQuestionType({ type: "theory" }), "TEXT");
    assert.equal(authoredQuestionType({ type: "mcq" }), "MCQ");
    assert.equal(authoredQuestionType({ questionType: "TRUE_FALSE" }), "TRUE_FALSE");
    assert.equal(authoredQuestionType({ type: "true-false" }), "TRUE_FALSE");
    assert.equal(authoredQuestionType({ text: "Explain osmosis." }), "TEXT");
  });

  it("prefers the schema type stored on a draft over the authoring kind", () => {
    assert.equal(authoredQuestionType({ questionType: "MCQ", type: "theory" }), "MCQ");
  });

  it("rejects a type the exam question schema does not store", () => {
    assert.equal(authoredQuestionType({ type: "diagram" }), null);
    assert.equal(authoringKind("diagram"), null);
    assert.equal(authoringKind("true_false"), "true_false");
  });
});

describe("question drafts", () => {
  it("starts a theory question with text marks and no choices", () => {
    assert.deepEqual(createQuestionDraft("theory", 1), {
      id: 1,
      type: "theory",
      text: "",
      marks: 10,
      questionType: "TEXT",
      answer: "",
    });
  });

  it("starts a multiple-choice question with four blank choices and no selected answer", () => {
    const draft = createQuestionDraft("mcq", 2);
    assert.equal(draft.questionType, "MCQ");
    assert.equal(draft.marks, 5);
    assert.deepEqual(draft.options, ["", "", "", ""]);
    assert.equal(draft.correctOption, undefined);
  });

  it("starts a true/false question with True and False and no selected answer", () => {
    const draft = createQuestionDraft("true_false", 3);
    assert.equal(draft.questionType, "TRUE_FALSE");
    assert.deepEqual(draft.options, ["True", "False"]);
    assert.equal(draft.correctOption, undefined);
  });

  it("keeps authored order when appending the next id", () => {
    const questions = [createQuestionDraft("theory", 1), createQuestionDraft("mcq", 4)];
    assert.equal(nextQuestionId(questions), 5);
    assert.equal(nextQuestionId([]), 1);
  });

  it("switches a theory question to multiple choice without keeping a stale answer index", () => {
    const theory = { ...createQuestionDraft("theory", 1), text: "Pick one", correctOption: 0 };
    const mcq = withQuestionType(theory, "MCQ");
    assert.equal(mcq.questionType, "MCQ");
    assert.equal(mcq.text, "Pick one");
    assert.equal(mcq.correctOption, undefined);
    assert.equal(mcq.options?.length, 4);
  });

  it("drops stale choices when a question becomes theory", () => {
    const mcq = {
      ...createQuestionDraft("mcq", 1),
      text: "Pick one",
      options: ["A", "B"],
      correctOption: 0,
    };
    const theory = mergeQuestionUpdate(mcq, withQuestionType(mcq, "TEXT"));
    assert.equal(theory.questionType, "TEXT");
    assert.equal(theory.text, "Pick one");
    assert.equal("options" in theory, false);
    assert.equal("correctOption" in theory, false);
  });

  it("switches to true/false with fixed options", () => {
    const mcq = {
      ...createQuestionDraft("mcq", 1),
      text: "Water boils at 100 C",
      options: ["Yes", "No", "Maybe"],
      correctOption: 2,
    };
    const trueFalse = withQuestionType(mcq, "TRUE_FALSE");
    assert.deepEqual(trueFalse.options, ["True", "False"]);
    assert.equal(trueFalse.correctOption, undefined);
    assert.equal(trueFalse.text, "Water boils at 100 C");
  });

  it("edits, appends, and removes choices while keeping the correct index aligned", () => {
    const options = replaceChoice(["A", "B", "C"], 1, "Bee");
    assert.deepEqual(options, ["A", "Bee", "C"]);
    assert.deepEqual(appendChoice(options), ["A", "Bee", "C", ""]);

    assert.deepEqual(removeChoice(["A", "B", "C"], 0, 2), { options: ["B", "C"], correctOption: 1 });
    assert.deepEqual(removeChoice(["A", "B", "C"], 2, 2), { options: ["A", "B"], correctOption: undefined });
    assert.deepEqual(removeChoice(["A", "B"], 0, 1), { options: ["A", "B"], correctOption: 1 });
  });
});

describe("type-specific question validation", () => {
  const theory = { text: "Explain osmosis.", marks: 10, questionType: "TEXT", answer: "Water crosses a membrane." };
  const mcq = {
    text: "Which planet is largest?",
    marks: 5,
    questionType: "MCQ",
    options: ["Mars", "Jupiter"],
    correctOption: 1,
  };
  const trueFalse = {
    text: "The earth is flat.",
    marks: 1,
    type: "TRUE_FALSE",
    options: ["True", "False"],
    correctOption: 1,
  };

  it("accepts theory, multiple choice, and true/false together", () => {
    assert.equal(findInvalidQuestion([theory, mcq, trueFalse]), null);
  });

  it("rejects an unsupported type before prompts would be created", () => {
    assert.equal(
      findInvalidQuestion([{ text: "Draw the cell.", marks: 4, type: "diagram" }]),
      "Question 1 has an unsupported type",
    );
  });

  it("rejects a multiple-choice question without two distinct choices and a correct one", () => {
    assert.equal(
      findInvalidQuestion([{ text: "Pick one", marks: 5, questionType: "MCQ" }]),
      "Question 1 needs at least two choices",
    );
    assert.equal(
      findInvalidQuestion([{ text: "Pick one", marks: 5, questionType: "MCQ", options: ["Only one"] }]),
      "Question 1 needs at least two choices",
    );
    assert.equal(
      findInvalidQuestion([{ text: "Pick one", marks: 5, type: "MCQ", options: ["A", "  "], correctOption: 0 }]),
      "Question 1 has an empty choice",
    );
    assert.equal(
      findInvalidQuestion([{ text: "Pick one", marks: 5, type: "MCQ", options: ["A", "a"], correctOption: 0 }]),
      "Question 1 has duplicate choices",
    );
    assert.equal(
      findInvalidQuestion([{ text: "Pick one", marks: 5, type: "MCQ", options: ["A", "B"] }]),
      "Question 1 needs a correct choice",
    );
    assert.equal(
      findInvalidQuestion([{ text: "Pick one", marks: 5, type: "MCQ", options: ["A", "B"], correctOption: 3 }]),
      "Question 1 needs a correct choice",
    );
  });

  it("rejects a true/false question that does not choose True or False", () => {
    assert.equal(
      findInvalidQuestion([{ text: "The sky is blue.", marks: 1, questionType: "TRUE_FALSE", options: ["Yes", "No"], correctOption: 0 }]),
      "Question 1 must offer True and False",
    );
    assert.equal(
      findInvalidQuestion([{
        text: "The sky is blue.",
        marks: 1,
        questionType: "TRUE_FALSE",
        options: ["True", "False"],
      }]),
      "Question 1 needs a correct answer",
    );
  });

  it("still accepts a theory question with no model answer", () => {
    assert.equal(findInvalidQuestion([{ text: "Explain osmosis.", marks: 8, type: "theory" }]), null);
  });
});

describe("create payload", () => {
  it("serializes each supported type in authored order and omits choices for theory", () => {
    const questions: ExamQuestionDraft[] = [
      { ...createQuestionDraft("true_false", 3), text: "Ice is solid.", correctOption: 0 },
      { ...createQuestionDraft("theory", 1), text: "Define heat.", answer: "Energy transfer." },
      {
        ...createQuestionDraft("mcq", 2),
        text: "Pick a gas.",
        options: ["Iron", "Oxygen"],
        correctOption: 1,
      },
    ];

    assert.deepEqual(toCreateExamQuestions(questions), [
      {
        text: "Ice is solid.",
        marks: 1,
        type: "TRUE_FALSE",
        answer: "",
        options: ["True", "False"],
        correctOption: 0,
      },
      {
        text: "Define heat.",
        marks: 10,
        type: "TEXT",
        answer: "Energy transfer.",
      },
      {
        text: "Pick a gas.",
        marks: 5,
        type: "MCQ",
        answer: "",
        options: ["Iron", "Oxygen"],
        correctOption: 1,
      },
    ]);
  });
});

describe("exam creation form offers every supported question type", () => {
  it("adds theory, multiple choice, and true/false from the editor", () => {
    const editor = read("packages/frontend/components/features/exams/QuestionEditor.tsx");
    assert.match(editor, /onAdd\("theory"\)/);
    assert.match(editor, /onAdd\("mcq"\)/);
    assert.match(editor, /onAdd\("true_false"\)/);
    assert.match(editor, /value="TRUE_FALSE"/);
    assert.match(editor, /Mark choice/);
    assert.match(editor, /Correct answer/);
  });

  it("builds every type through the shared draft helper instead of an unreachable branch", () => {
    const page = read("packages/frontend/app/dashboard/exams/create/page.tsx");
    assert.match(page, /createQuestionDraft\(kind, nextQuestionId\(questions\)\)/);
    assert.match(page, /mergeQuestionUpdate\(q, data\)/);
    assert.match(page, /toCreateExamQuestions\(questions\)/);
    assert.doesNotMatch(page, /else if \(type === "mcq"\)/);
    assert.match(page, /findInvalidQuestion\(questions\)/);
    assert.match(page, /findMissingStudentAssignees\(examType, selectedStudentIds\)/);
    assert.match(page, /examUsers: examUsersForCreation\(examType, selectedStudentIds\)/);
  });

  it("stores the normalized type only after question validation", () => {
    const route = read("packages/frontend/app/api/exams/create/route.ts");
    const validationIndex = route.indexOf("findInvalidQuestion(questions)");
    const promptIndex = route.indexOf("promptRepo.createBulk(");
    assert.ok(validationIndex > -1 && promptIndex > validationIndex);
    assert.match(route, /authoredQuestionType\(q\)/);
  });
});
