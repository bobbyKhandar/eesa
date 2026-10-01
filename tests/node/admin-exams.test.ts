import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { filterAdminExams, toAdminExamRow } from "../../packages/frontend/lib/adminExamList.ts";

describe("toAdminExamRow", () => {
  it("maps a stored exam and ignores missing optional fields", () => {
    assert.deepEqual(
      toAdminExamRow({
        _id: "e1",
        examTitle: "Operating Systems",
        subject: "CS",
        duration: 60,
        assignedUsers: ["a", "b"],
        createdBy: "teacher",
        scheduledAt: "2026-10-01T00:00:00.000Z",
      }),
      {
        id: "e1",
        title: "Operating Systems",
        subject: "CS",
        duration: 60,
        assignedCount: 2,
        createdBy: "teacher",
        scheduledAt: "2026-10-01T00:00:00.000Z",
      },
    );
  });

  it("drops a document that has no title", () => {
    assert.equal(toAdminExamRow({ _id: "e1", examTitle: "  " }), null);
    assert.equal(toAdminExamRow(null), null);
  });
});

describe("filterAdminExams", () => {
  const rows = [
    toAdminExamRow({ _id: "1", examTitle: "Physics Midterm", subject: "PHY" })!,
    toAdminExamRow({ _id: "2", examTitle: "Calculus", subject: "Mathematics" })!,
  ];

  it("matches title or subject", () => {
    assert.deepEqual(
      filterAdminExams(rows, "math").map((row) => row.id),
      ["2"],
    );
  });

  it("returns every row for a blank search", () => {
    assert.equal(filterAdminExams(rows, "  ").length, 2);
  });
});
