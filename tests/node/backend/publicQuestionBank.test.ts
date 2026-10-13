import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { queryPrompts } from "../../../packages/frontend/lib/subjectQuestionBank.ts";
import {
  isPublicQuestionBankPrompt,
  publicPromptSubjectQuery,
  publicQuestionBankPrompts,
} from "../../../packages/backend/src/services/publicQuestionBank.ts";

const unpublishedExamPrompt = {
  _id: "exam-prompt",
  questionText: "Unpublished midterm: derive the private marking scheme.",
  subject: "Biology",
  generateVia: "user",
  createdBy: "teacher_1",
};

describe("public question bank publication filter", () => {
  it("hides exam prompts that were never published", () => {
    assert.equal(isPublicQuestionBankPrompt(unpublishedExamPrompt), false);
    const visible = publicQuestionBankPrompts([
      unpublishedExamPrompt,
      {
        _id: "ocr-paper",
        questionText: "Explain osmosis.",
        subject: "Biology",
        generateVia: "ocr",
        createdBy: "teacher_1",
      },
      {
        _id: "bedrock-paper",
        questionText: "Define mitosis.",
        subject: "Biology",
        generateVia: "bedrock",
      },
      {
        _id: "llm-paper",
        questionText: "Compare DNA and RNA.",
        subject: "Biology",
        generateVia: "llm",
        createdBy: "publisher_1",
      },
    ]);

    assert.deepEqual(
      visible.map((prompt) => prompt._id),
      ["ocr-paper", "bedrock-paper", "llm-paper"]
    );
    assert.equal(
      visible.some((prompt) => String(prompt.questionText).includes("Unpublished midterm")),
      false
    );
  });

  it("keeps a published analysis prompt even when it records createdBy", () => {
    const published = {
      _id: "published",
      questionText: "Describe photosynthesis.",
      generateVia: "ocr",
      createdBy: "teacher_1",
    };
    assert.equal(isPublicQuestionBankPrompt(published), true);
    assert.equal(publicQuestionBankPrompts([published]).length, 1);
  });

  it("keeps legacy bank prompts that predate generateVia", () => {
    const legacy = { _id: "legacy", questionText: "Old paper question" };
    assert.equal(isPublicQuestionBankPrompt(legacy), true);
    assert.deepEqual(publicQuestionBankPrompts([legacy]), [legacy]);
  });

  it("does not let a fallback search return the unpublished stem", () => {
    const visible = publicQuestionBankPrompts([
      unpublishedExamPrompt,
      { _id: "public", questionText: "Explain osmosis.", generateVia: "ocr" },
    ]);
    assert.deepEqual(queryPrompts(visible, { search: "midterm" }), []);
    assert.equal(queryPrompts(visible, { search: "osmosis" })[0]?._id, "public");
  });

  it("queries the prompt collection with the same publication filter", () => {
    assert.deepEqual(publicPromptSubjectQuery("Biology"), {
      subject: "Biology",
      generateVia: { $ne: "user" },
    });
  });
});

describe("public unique-questions fallback wiring", () => {
  const route = readFileSync(
    "packages/frontend/app/api/unique-questions/route.ts",
    "utf8"
  );
  const repository = readFileSync(
    "packages/backend/src/database/repositories/PromptRepository.ts",
    "utf8"
  );

  it("filters every prompt fallback through the publication check", () => {
    assert.match(route, /publicQuestionBankPrompts/);
    assert.match(route, /loadPublicFallbackPrompts\(/);
    // The filtered repository lookup happens once, inside the helper.
    // Each response path must go through that helper.
    assert.equal((route.match(/promptRepo\.findBySubject\(/g) ?? []).length, 1);
    assert.equal((route.match(/loadPublicFallbackPrompts\(/g) ?? []).length, 5);
  });

  it("does not load every prompt for the subject", () => {
    assert.match(repository, /publicPromptSubjectQuery\(subject\)/);
    assert.doesNotMatch(
      repository,
      /find\(\{\s*subject\s*\}\)/
    );
  });
});
