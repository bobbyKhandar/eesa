/**
 * Single-exam analysis must not offer syllabus alignment, or mark questions
 * aligned, until a persisted syllabus is actually matched.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  questionsWithoutComputedSyllabusAlignment,
  syllabusOptionsWithoutAlignment,
} from "../../../packages/frontend/lib/syllabusAlignment.ts";

const ANALYZE_PAGE = "packages/frontend/app/ai-analyze/page.tsx";
const UPLOAD_ROUTE = "packages/frontend/app/api/exam-analysis/upload/route.ts";

describe("syllabus options are not recorded without a match", () => {
  it("drops an uploaded file and a client syllabus id", () => {
    const options = syllabusOptionsWithoutAlignment({
      alignWithSyllabus: true,
      syllabusId: "syll-phy-2025",
      syllabusFileName: "physics-2025.pdf",
      comparePastPapers: true,
    });

    assert.equal(options.alignWithSyllabus, false);
    assert.equal(Object.hasOwn(options, "syllabusId"), false);
    assert.equal(Object.hasOwn(options, "syllabusFileName"), false);
    assert.equal(options.comparePastPapers, true);
    assert.deepEqual(options.pastPaperIds, []);
  });

  it("keeps past-paper comparison when syllabus fields are absent", () => {
    const options = syllabusOptionsWithoutAlignment({
      comparePastPapers: false,
      pastPaperIds: ["paper-1"],
    });

    assert.equal(options.alignWithSyllabus, false);
    assert.equal(options.comparePastPapers, false);
    assert.deepEqual(options.pastPaperIds, ["paper-1"]);
  });
});

describe("questions are not marked syllabus-aligned", () => {
  it("does not treat classifier topics as a syllabus match", () => {
    const [question] = questionsWithoutComputedSyllabusAlignment([
      {
        questionNumber: "1a",
        questionText: "State Newton's second law.",
        marks: 5,
        bloomLevel: "Recall",
        bloomJustification: "Asks for a recalled statement.",
        confidence: 0.91,
        difficulty: "Easy",
        keywords: ["force", "acceleration"],
        topicsCovered: ["Newton's Laws"],
      },
    ]);

    assert.equal(question.isSyllabusAligned, false);
    assert.deepEqual(question.syllabusTopics, []);
    assert.equal(question.questionNumber, "1a");
    assert.equal(question.questionText, "State Newton's second law.");
    assert.equal(question.marks, 5);
    assert.equal(question.bloomLevel, "Recall");
    assert.equal(question.bloomJustification, "Asks for a recalled statement.");
    assert.equal(question.confidence, 0.91);
    assert.equal(question.difficulty, "Easy");
    assert.deepEqual(question.keywords, ["force", "acceleration"]);
    assert.deepEqual(question.similarQuestionIds, []);
  });

  it("returns an empty list when there are no questions", () => {
    assert.deepEqual(questionsWithoutComputedSyllabusAlignment([]), []);
  });
});

describe("single analysis screen", () => {
  it("does not offer a syllabus upload or hard-coded saved syllabi", () => {
    const page = readFileSync(ANALYZE_PAGE, "utf8");

    assert.doesNotMatch(page, /syllabusFile/);
    assert.doesNotMatch(page, /syllabusId/);
    assert.doesNotMatch(page, /syll-phy-2025/);
    assert.doesNotMatch(page, /syll-math-2024/);
    assert.doesNotMatch(page, /syll-chem-2023/);
    assert.doesNotMatch(page, /Align with syllabus/);
    assert.doesNotMatch(page, /alignWithSyllabus/);
  });

  it("saves questions through the helper that refuses uncomputed alignment", () => {
    const route = readFileSync(UPLOAD_ROUTE, "utf8");

    assert.match(route, /syllabusOptionsWithoutAlignment\(/);
    assert.match(route, /questionsWithoutComputedSyllabusAlignment\(/);
    assert.doesNotMatch(route, /isSyllabusAligned:\s*true/);
    assert.doesNotMatch(route, /syllabusTopics:\s*q\.topicsCovered/);
  });
});
