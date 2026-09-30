import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  normalizeSubjectSummaries,
  sortYearsDescending,
} from "../../../packages/backend/src/database/repositories/subjectSummary.ts";

describe("sortYearsDescending", () => {
  it("sorts numeric years newest first", () => {
    assert.deepEqual(sortYearsDescending(["2022", "2024", "2023"]), ["2024", "2023", "2022"]);
  });

  it("de-duplicates years", () => {
    assert.deepEqual(sortYearsDescending(["2024", "2024"]), ["2024"]);
  });

  it("handles non-numeric values without throwing", () => {
    assert.deepEqual(sortYearsDescending(["FY", "SY"]), ["SY", "FY"]);
    assert.deepEqual(sortYearsDescending([]), []);
  });
});

describe("normalizeSubjectSummaries", () => {
  it("returns one row per subject and sorts years newest first", () => {
    const rows = normalizeSubjectSummaries([
      { subjectName: "Data Structures", reportCount: 2, years: ["2022", "2024"] },
      { subjectName: "Operating Systems", reportCount: 1, years: ["2023"] },
    ]);

    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0].years, ["2024", "2022"]);
    assert.equal(rows[0].latestYear, "2024");
  });

  it("merges rows that share a subject name", () => {
    // Grouping by name + code + branch produced several rows per subject.
    const rows = normalizeSubjectSummaries([
      { subjectName: "Data Structures", subjectCode: "CS205", branch: "CSE", reportCount: 2, years: ["2023"] },
      { subjectName: "Data Structures", subjectCode: "CS205", branch: "IT", reportCount: 1, years: ["2024"] },
    ]);

    assert.equal(rows.length, 1);
    assert.equal(rows[0].reportCount, 3);
    assert.deepEqual(rows[0].years, ["2024", "2023"]);
    assert.equal(rows[0].latestYear, "2024");
  });

  it("collects every branch for a subject", () => {
    const rows = normalizeSubjectSummaries([
      { subjectName: "Data Structures", branch: "CSE", branches: ["CSE", "IT"], reportCount: 2, years: ["2024"] },
    ]);

    assert.deepEqual(rows[0].branches, ["CSE", "IT"]);
    assert.equal(rows[0].branch, "CSE");
  });

  it("always exposes a branches array", () => {
    const rows = normalizeSubjectSummaries([{ subjectName: "Maths", reportCount: 1, years: ["2024"] }]);
    assert.deepEqual(rows[0].branches, []);
  });

  it("drops rows without a subject name", () => {
    const rows = normalizeSubjectSummaries([
      { subjectName: "", reportCount: 1, years: ["2024"] },
      { subjectName: "   ", reportCount: 1, years: ["2024"] },
      { subjectName: "Data Structures", reportCount: 1, years: ["2024"] },
    ]);

    assert.equal(rows.length, 1);
    assert.equal(rows[0].subjectName, "Data Structures");
  });

  it("sorts rows by subject name", () => {
    const rows = normalizeSubjectSummaries([
      { subjectName: "Zoology", reportCount: 1, years: ["2024"] },
      { subjectName: "Algebra", reportCount: 1, years: ["2024"] },
      { subjectName: "Microbiology", reportCount: 1, years: ["2024"] },
    ]);

    assert.deepEqual(
      rows.map((row) => row.subjectName),
      ["Algebra", "Microbiology", "Zoology"]
    );
  });

  it("derives latestYear from years when the aggregation omits it", () => {
    const rows = normalizeSubjectSummaries([{ subjectName: "Physics", reportCount: 1, years: ["2021", "2022"] }]);
    assert.equal(rows[0].latestYear, "2022");
  });

  it("handles an empty or malformed input", () => {
    assert.deepEqual(normalizeSubjectSummaries([]), []);
    assert.deepEqual(normalizeSubjectSummaries(undefined as any), []);
  });
});