/**
 * Previous-year question controls must act on questions the resources page
 * already loaded: a preview of one row, and a CSV of the listed questions.
 * There is no stored paper file to fetch.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  describePyq,
  pyqCsvFileName,
  pyqsDownload,
} from "../../../packages/frontend/lib/pyqExport.ts";

const PYQS_TABLE = "packages/frontend/components/features/resources/PyqsTable.tsx";

const sampleQuestion = {
  title: "Stack definition",
  questionText: 'Define a stack, "LIFO".',
  years: ["2023", "2024"],
  frequency: 3,
  difficulty: "Medium",
  bloomsLevel: "Remember",
  topics: ["Stacks", "Queues"],
  examType: "main",
};

describe("previous-year question CSV", () => {
  it("exports the listed questions with spreadsheet-safe quoting", () => {
    const download = pyqsDownload([sampleQuestion], "Data Structures");

    assert.equal(download.fileName, "data-structures-pyqs.csv");
    assert.equal(download.mimeType, "text/csv;charset=utf-8");
    assert.equal(
      download.contents,
      [
        "Question,Year,Frequency,Difficulty,Bloom's Level,Topics,Exam Type",
        '"Define a stack, ""LIFO"".","2023, 2024",3,Medium,Remember,"Stacks, Queues",Main Exam',
        "",
      ].join("\r\n")
    );
  });

  it("prefixes formula-like question text so a spreadsheet does not execute it", () => {
    const download = pyqsDownload(
      [{ ...sampleQuestion, questionText: "=1+1", topics: ["+Stacks"] }],
      "Data Structures"
    );

    assert.match(download.contents, /'=1\+1,"2023, 2024",3,Medium,Remember,'\+Stacks,Main Exam/);
  });

  it("emits a header-only file when nothing is listed", () => {
    const download = pyqsDownload([], "Data Structures");

    assert.equal(
      download.contents,
      "Question,Year,Frequency,Difficulty,Bloom's Level,Topics,Exam Type\r\n"
    );
  });

  it("falls back to a single year and a blank subject name", () => {
    assert.equal(pyqCsvFileName("  "), "pyqs.csv");
    assert.equal(pyqCsvFileName("Midterm Physics"), "midterm-physics-pyqs.csv");

    const download = pyqsDownload(
      [
        {
          questionText: "State Ohm's law.",
          year: "2022",
          occurrenceCount: 1,
          examType: "kt",
        },
      ],
      "   "
    );

    assert.equal(download.fileName, "pyqs.csv");
    assert.match(download.contents, /State Ohm's law\.,2022,1,,,,KT Exam/);
  });
});

describe("previous-year question preview", () => {
  it("describes the question and the metadata already on the row", () => {
    const preview = describePyq(sampleQuestion);

    assert.equal(preview.title, "Stack definition");
    assert.equal(preview.questionText, 'Define a stack, "LIFO".');
    assert.equal(preview.yearsLabel, "2023, 2024");
    assert.equal(preview.frequencyLabel, "3×");
    assert.equal(preview.difficulty, "Medium");
    assert.equal(preview.bloomsLevel, "Remember");
    assert.equal(preview.topicsLabel, "Stacks, Queues");
    assert.equal(preview.examType, "Main Exam");
  });

  it("uses the same empty-state labels as the table when fields are missing", () => {
    const preview = describePyq({
      questionText: "",
      frequency: 0,
    });

    assert.equal(preview.title, "Question");
    assert.equal(preview.questionText, "");
    assert.equal(preview.yearsLabel, "N/A");
    assert.equal(preview.frequencyLabel, "0×");
    assert.equal(preview.difficulty, "Medium");
    assert.equal(preview.topicsLabel, "");
    assert.equal(preview.examType, "");
    assert.equal(preview.bloomsLevel, "");
  });
});

describe("question-bank table wires preview and download", () => {
  it("downloads the listed rows and opens a preview from the eye button", () => {
    const source = readFileSync(PYQS_TABLE, "utf8");

    assert.match(source, /pyqsDownload\(pyqs, subjectName\)/);
    assert.match(source, /triggerTextDownload\(/);
    assert.match(source, /describePyq\(pyq\)/);
    assert.match(source, /disabled=\{!canDownload\}/);
    assert.match(source, /aria-label=\{`Preview \$\{details\.title\}`\}/);
    assert.match(source, /<Dialog[\s\S]*open=\{preview !== null\}/);
    assert.doesNotMatch(
      source,
      /<Button variant="ghost" size="sm">\s*<Eye/
    );
    assert.doesNotMatch(
      source,
      /<Button variant="outline" size="sm" className="gap-1 bg-transparent">\s*<Download/
    );
  });
});
