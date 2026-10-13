import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { promptZodSchema } from "../../../packages/backend/src/database/schemas/promptSchemaZod.ts";
import { publicPromptSubjectQuery } from "../../../packages/backend/src/services/publicQuestionBank.ts";
import {
  buildSimilarQuestionsFilter,
  promptMatchesSimilarQuestionSearch,
} from "../../../packages/backend/src/services/similarQuestionQuery.ts";

const serviceSource = readFileSync(
  "packages/backend/src/services/questionSimilarityService.ts",
  "utf8"
);

/**
 * Shape written by PromptRepository.create: promptZodSchema has neither
 * isActive nor normalizedText, so both are absent on the stored document.
 */
const applicationPrompt = promptZodSchema.parse({
  questionText: "Explain the process of photosynthesis in green plants",
  subject: "Biology",
  generateVia: "ocr",
  createdBy: "ai-pipeline",
});

describe("findSimilarQuestionsInDB matches prompts as stored", () => {
  it("does not require isActive true or a normalizedText field", () => {
    assert.equal("isActive" in applicationPrompt, false);
    assert.equal("normalizedText" in applicationPrompt, false);
    assert.match(serviceSource, /buildSimilarQuestionsFilter\(/);
    assert.doesNotMatch(serviceSource, /normalizedText/);
    assert.doesNotMatch(serviceSource, /isActive:\s*true/);
  });

  it("treats a missing isActive as active and still skips explicit false", () => {
    const query = "Explain the process of photosynthesis in leaves";

    assert.equal(
      promptMatchesSimilarQuestionSearch(applicationPrompt, query, "Biology"),
      true
    );
    assert.equal(
      promptMatchesSimilarQuestionSearch(
        { ...applicationPrompt, isActive: true },
        query,
        "Biology"
      ),
      true
    );
    assert.equal(
      promptMatchesSimilarQuestionSearch(
        { ...applicationPrompt, isActive: false },
        query,
        "Biology"
      ),
      false
    );
  });

  it("matches questionText and does not depend on normalizedText", () => {
    const filter = buildSimilarQuestionsFilter(
      "Explain the process of photosynthesis in leaves",
      "Biology",
      ["507f1f77bcf86cd799439011"]
    );

    assert.equal(JSON.stringify(filter).includes("normalizedText"), false);
    assert.deepEqual(filter.isActive, { $ne: false });
    assert.equal(filter.subject, "Biology");
    assert.deepEqual(filter.excludedIds, ["507f1f77bcf86cd799439011"]);
    assert.equal(filter.questionText?.$options, "i");
    assert.match(applicationPrompt.questionText, new RegExp(filter.questionText!.$regex, "i"));

    assert.equal(
      promptMatchesSimilarQuestionSearch(
        {
          ...applicationPrompt,
          questionText: "PHOTOSYNTHESIS keeps plants alive",
          normalizedText: undefined,
        },
        "How does photosynthesis work in leaves?",
        "Biology"
      ),
      true
    );
    assert.equal(
      promptMatchesSimilarQuestionSearch(
        {
          ...applicationPrompt,
          questionText: "Describe the structure of a neuron",
        },
        "How does photosynthesis work in leaves?",
        "Biology"
      ),
      false
    );
  });

  it("skips the prompt being linked and prompts from another subject", () => {
    const prompt = { ...applicationPrompt, _id: "prompt-self" };
    const query = "Explain the process of photosynthesis in leaves";

    assert.equal(
      promptMatchesSimilarQuestionSearch(prompt, query, "Biology", ["prompt-self"]),
      false
    );
    assert.equal(
      promptMatchesSimilarQuestionSearch(prompt, query, "Chemistry"),
      false
    );
  });

  it("leaves public-bank filtering of user exam drafts in place", () => {
    const unpublishedExamPrompt = promptZodSchema.parse({
      questionText: "Unpublished midterm: derive the private marking scheme for photosynthesis",
      subject: "Biology",
      generateVia: "user",
      createdBy: "teacher_1",
    });

    assert.deepEqual(publicPromptSubjectQuery("Biology"), {
      subject: "Biology",
      generateVia: { $ne: "user" },
    });
    assert.equal(publicPromptSubjectQuery("Biology").generateVia.$ne, "user");

    // Similarity linking reads the prompt collection directly. Publication
    // filtering stays on the public bank query and is not dropped here.
    assert.equal(
      promptMatchesSimilarQuestionSearch(
        unpublishedExamPrompt,
        "Explain photosynthesis and the marking scheme",
        "Biology"
      ),
      true
    );
    assert.equal(
      JSON.stringify(buildSimilarQuestionsFilter(
        "Explain photosynthesis and the marking scheme",
        "Biology"
      )).includes("generateVia"),
      false
    );
  });
});
