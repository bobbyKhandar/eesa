import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  appendCreatedPrompt,
  buildPromptPayload,
  type CreatedPrompt,
} from "../../../packages/backend/src/services/analysisHelpers.ts";

const context = { subject: "Physics", source: "physics-2024.pdf" };

describe("buildPromptPayload", () => {
  it("maps the analysis Bloom label onto the prompt enum", () => {
    const payload = buildPromptPayload(
      { questionText: "Define inertia.", bloomLevel: "Recall" },
      context
    );

    assert.equal(payload?.bloomsLevel, "remember");
    assert.equal(payload?.questionText, "Define inertia.");
    assert.equal(payload?.generateVia, "ocr");
    assert.equal(payload?.subject, "Physics");
    assert.equal(payload?.source, "physics-2024.pdf");
  });

  it("returns null for blank question text so no orphan prompt is created", () => {
    assert.equal(buildPromptPayload({ questionText: "   " }, context), null);
    assert.equal(buildPromptPayload({ questionText: "" }, context), null);
    assert.equal(buildPromptPayload({}, context), null);
  });

  it("joins keywords into a topic and drops non-string entries", () => {
    const payload = buildPromptPayload(
      { questionText: "Q", keywords: ["mechanics", 7, "rotational"] },
      context
    );

    assert.equal(payload?.topic, "mechanics, rotational");
  });

  it("omits the topic when no usable keywords exist", () => {
    assert.equal(buildPromptPayload({ questionText: "Q", keywords: [] }, context)?.topic, undefined);
    assert.equal(buildPromptPayload({ questionText: "Q" }, context)?.topic, undefined);
  });

  it("only forwards finite numeric confidence", () => {
    assert.equal(
      buildPromptPayload({ questionText: "Q", confidence: 0.91 }, context)?.ocrConfidence,
      0.91
    );
    assert.equal(
      buildPromptPayload({ questionText: "Q", confidence: Number.NaN }, context)?.ocrConfidence,
      undefined
    );
    assert.equal(
      buildPromptPayload({ questionText: "Q", confidence: "high" as unknown as number }, context)
        ?.ocrConfidence,
      undefined
    );
  });

  it("falls back to understand for unknown Bloom labels", () => {
    assert.equal(
      buildPromptPayload({ questionText: "Q", bloomLevel: "Bloomish" }, context)?.bloomsLevel,
      "understand"
    );
  });
});

describe("appendCreatedPrompt", () => {
  interface Q {
    id: string;
  }

  it("keeps every prompt ID aligned with its own question across failures", () => {
    const questions: Q[] = [{ id: "q1" }, { id: "q2" }, { id: "q3" }];

    let created: CreatedPrompt<Q>[] = [];

    // Simulate the repository failing on the middle question.
    const results = [
      { success: true, promptId: "p1" },
      { success: false, error: "duplicate key" },
      { success: true, promptId: "p3" },
    ];

    questions.forEach((question, index) => {
      created = appendCreatedPrompt(created, question, results[index]);
    });

    assert.deepEqual(
      created.map((entry) => [entry.question.id, entry.promptId]),
      [
        ["q1", "p1"],
        ["q3", "p3"],
      ]
    );

    // The report's questionIds must line up with the paired questions.
    const questionIds = created.map((entry) => entry.promptId);
    assert.deepEqual(questionIds, ["p1", "p3"]);
    assert.equal(questionIds.length, created.length);
  });

  it("ignores results without a prompt id", () => {
    const created: CreatedPrompt<Q>[] = [];
    assert.equal(appendCreatedPrompt(created, { id: "q1" }, { success: true }).length, 0);
    assert.equal(appendCreatedPrompt(created, { id: "q1" }, {}).length, 0);
  });

  it("does not mutate the array it is given", () => {
    const created: CreatedPrompt<Q>[] = [];
    const next = appendCreatedPrompt(created, { id: "q1" }, { success: true, promptId: "p1" });

    assert.equal(created.length, 0);
    assert.equal(next.length, 1);
  });
});