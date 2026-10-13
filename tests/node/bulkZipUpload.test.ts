/**
 * ZIP bulk upload must turn an archive of exam PDFs into the same per-file
 * status rows the bulk page already stores for /api/exam-analysis/upload-bulk.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import JSZip from "jszip";

import {
  collectZipResults,
  extractZipPdfs,
  isZipUpload,
  planZipPdfs,
  statusesFromBulkResponse,
  type ZipEntryInfo,
} from "../../packages/frontend/lib/bulkZipUpload.ts";

const ZIP_ROUTE = "packages/frontend/app/api/exam-analysis/upload-bulk-zip/route.ts";
const BULK_ROUTE = "packages/frontend/app/api/exam-analysis/upload-bulk/route.ts";

async function zipOf(files: Record<string, string | Uint8Array>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) {
    zip.file(name, content);
  }
  return zip.generateAsync({ type: "uint8array" });
}

describe("isZipUpload", () => {
  it("accepts a .zip name or a zip MIME type", () => {
    assert.equal(isZipUpload({ name: "papers.ZIP", type: "" }), true);
    assert.equal(isZipUpload({ name: "papers.bin", type: "application/zip" }), true);
    assert.equal(
      isZipUpload({ name: "papers.bin", type: "application/x-zip-compressed" }),
      true
    );
  });

  it("rejects a plain PDF", () => {
    assert.equal(isZipUpload({ name: "paper.pdf", type: "application/pdf" }), false);
  });
});

describe("planZipPdfs", () => {
  const limits = {
    maxEntries: 5,
    maxPdfs: 3,
    maxPdfBytes: 100,
    maxTotalBytes: 150,
  };

  it("keeps nested PDFs and skips junk, directories, and path traversal", () => {
    const entries: ZipEntryInfo[] = [
      { name: "exams/", dir: true, uncompressedSize: 0 },
      { name: "exams/2024/Algebra.pdf", dir: false, uncompressedSize: 10 },
      { name: "notes.txt", dir: false, uncompressedSize: 4 },
      { name: "__MACOSX/._Algebra.pdf", dir: false, uncompressedSize: 8 },
      { name: "../secret.pdf", dir: false, uncompressedSize: 8 },
      { name: "folder/../../escape.pdf", dir: false, uncompressedSize: 8 },
    ];

    const plan = planZipPdfs(entries, { ...limits, maxEntries: 10 });
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.deepEqual(
      plan.pdfs.map((pdf) => pdf.fileName),
      ["Algebra.pdf"]
    );
    assert.equal(plan.pdfs[0].entryName, "exams/2024/Algebra.pdf");
  });

  it("disambiguates PDFs that share a base name", () => {
    const plan = planZipPdfs(
      [
        { name: "a/paper.pdf", dir: false, uncompressedSize: 5 },
        { name: "b/paper.pdf", dir: false, uncompressedSize: 6 },
      ],
      limits
    );
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.deepEqual(
      plan.pdfs.map((pdf) => pdf.fileName),
      ["paper.pdf", "paper-2.pdf"]
    );
  });

  it("rejects an archive with no PDFs", () => {
    const plan = planZipPdfs(
      [{ name: "readme.txt", dir: false, uncompressedSize: 3 }],
      limits
    );
    assert.deepEqual(plan, { ok: false, error: "No PDF files found in the ZIP" });
  });

  it("rejects too many entries, too many PDFs, and oversized files", () => {
    const tooManyEntries = planZipPdfs(
      Array.from({ length: 6 }, (_, index) => ({
        name: `notes-${index}.txt`,
        dir: false,
        uncompressedSize: 1,
      })),
      limits
    );
    assert.equal(tooManyEntries.ok, false);
    if (!tooManyEntries.ok) {
      assert.match(tooManyEntries.error, /more than 5 entries/);
    }

    const tooManyPdfs = planZipPdfs(
      Array.from({ length: 4 }, (_, index) => ({
        name: `paper-${index}.pdf`,
        dir: false,
        uncompressedSize: 1,
      })),
      limits
    );
    assert.equal(tooManyPdfs.ok, false);
    if (!tooManyPdfs.ok) {
      assert.match(tooManyPdfs.error, /more than 3 PDF/);
    }

    const oversized = planZipPdfs(
      [{ name: "scan.pdf", dir: false, uncompressedSize: 101 }],
      limits
    );
    assert.equal(oversized.ok, false);
    if (!oversized.ok) {
      assert.match(oversized.error, /scan\.pdf/);
    }

    const total = planZipPdfs(
      [
        { name: "a.pdf", dir: false, uncompressedSize: 80 },
        { name: "b.pdf", dir: false, uncompressedSize: 80 },
      ],
      limits
    );
    assert.equal(total.ok, false);
    if (!total.ok) {
      assert.match(total.error, /uncompressed/);
    }
  });
});

describe("extractZipPdfs", () => {
  it("returns PDF bytes and ignores the other archive members", async () => {
    const bytes = await zipOf({
      "set/one.pdf": "pdf-one",
      "set/two.PDF": "pdf-two",
      "set/notes.txt": "ignore",
      "__MACOSX/._one.pdf": "apple",
    });

    const extracted = await extractZipPdfs(bytes);
    assert.equal(extracted.ok, true);
    if (!extracted.ok) return;
    assert.deepEqual(
      extracted.files.map((file) => file.fileName),
      ["one.pdf", "two.PDF"]
    );
    assert.equal(Buffer.from(extracted.files[0].bytes).toString(), "pdf-one");
    assert.equal(Buffer.from(extracted.files[1].bytes).toString(), "pdf-two");
  });

  it("does not extract members whose original path climbs out of the archive", async () => {
    const bytes = await zipOf({
      "exams/ok.pdf": "safe",
      "../secret.pdf": "nope",
      "nested/../../escape.pdf": "nope",
    });

    const extracted = await extractZipPdfs(bytes);
    assert.equal(extracted.ok, true);
    if (!extracted.ok) return;
    assert.deepEqual(
      extracted.files.map((file) => file.fileName),
      ["ok.pdf"]
    );
    assert.equal(Buffer.from(extracted.files[0].bytes).toString(), "safe");
  });

  it("rejects a corrupt archive", async () => {
    const extracted = await extractZipPdfs(new Uint8Array([1, 2, 3, 4]));
    assert.deepEqual(extracted, { ok: false, error: "Invalid ZIP file" });
  });

  it("rejects an archive whose inflated PDF exceeds the limit", async () => {
    const bytes = await zipOf({ "scan.pdf": "0123456789" });
    const extracted = await extractZipPdfs(bytes, {
      maxEntries: 10,
      maxPdfs: 10,
      maxPdfBytes: 4,
      maxTotalBytes: 100,
    });
    assert.equal(extracted.ok, false);
    if (!extracted.ok) assert.match(extracted.error, /scan\.pdf/);
  });
});

describe("statusesFromBulkResponse", () => {
  it("maps a single-subject upload onto one success row", () => {
    const rows = statusesFromBulkResponse("paper.pdf", {
      success: true,
      analysisId: "an-1",
      extractedMetadata: { subjectName: "Physics", year: "2024", semester: "S3" },
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "success");
    assert.equal(rows[0].fileName, "paper.pdf");
    assert.equal(rows[0].analysisId, "an-1");
    assert.equal(rows[0].progress, 100);
    assert.equal(rows[0].extractedMetadata?.subjectName, "Physics");
  });

  it("flattens a multi-subject PDF the same way the bulk page does", () => {
    const rows = statusesFromBulkResponse("bundle.pdf", {
      success: true,
      multipleSubjects: true,
      analyses: [
        { analysisId: "a", subjectName: "Physics", extractedMetadata: { subjectName: "Physics" } },
        { analysisId: "b", subjectName: "Maths" },
      ],
    });
    assert.deepEqual(
      rows.map((row) => ({ fileName: row.fileName, analysisId: row.analysisId, status: row.status })),
      [
        { fileName: "bundle.pdf - Physics", analysisId: "a", status: "success" },
        { fileName: "bundle.pdf - Maths", analysisId: "b", status: "success" },
      ]
    );
  });

  it("records a per-file error when the upload did not create an analysis", () => {
    assert.equal(
      statusesFromBulkResponse("paper.pdf", { success: false, error: "OCR failed" })[0].error,
      "OCR failed"
    );
    assert.equal(statusesFromBulkResponse("paper.pdf", null)[0].error, "Upload failed");
    assert.equal(
      statusesFromBulkResponse("paper.pdf", {
        success: true,
        multipleSubjects: true,
        analyses: [],
      })[0].error,
      "No subjects detected"
    );
  });
});

describe("collectZipResults", () => {
  it("keeps going after one PDF fails and flattens split papers", async () => {
    const seen: string[] = [];
    const results = await collectZipResults(
      [
        { fileName: "ok.pdf", bytes: new Uint8Array([1, 2]) },
        { fileName: "bad.pdf", bytes: new Uint8Array([3]) },
        { fileName: "split.pdf", bytes: new Uint8Array([4]) },
        { fileName: "empty.pdf", bytes: new Uint8Array() },
      ],
      async (file) => {
        seen.push(file.name);
        assert.equal(file.type, "application/pdf");
        if (file.name === "bad.pdf") throw new Error("disk full");
        if (file.name === "split.pdf") {
          return {
            success: true,
            multipleSubjects: true,
            analyses: [
              { analysisId: "s1", subjectName: "Physics" },
              { analysisId: "s2", subjectName: "Maths" },
            ],
          };
        }
        const bytes = new Uint8Array(await file.arrayBuffer());
        assert.deepEqual(Array.from(bytes), [1, 2]);
        return {
          success: true,
          analysisId: "ok-1",
          extractedMetadata: { subjectName: "Circuits", year: "2024", semester: "S1" },
        };
      }
    );

    assert.deepEqual(seen, ["ok.pdf", "bad.pdf", "split.pdf"]);
    assert.deepEqual(
      results.map((row) => ({ fileName: row.fileName, status: row.status, error: row.error })),
      [
        { fileName: "ok.pdf", status: "success", error: undefined },
        { fileName: "bad.pdf", status: "error", error: "disk full" },
        { fileName: "split.pdf - Physics", status: "success", error: undefined },
        { fileName: "split.pdf - Maths", status: "success", error: undefined },
        { fileName: "empty.pdf", status: "error", error: "PDF is empty" },
      ]
    );
    assert.equal(results[0].analysisId, "ok-1");
  });
});

describe("upload-bulk-zip route", () => {
  it("requires a signed-in owner before ingesting archive members", () => {
    const source = readFileSync(ZIP_ROUTE, "utf8");
    const authAt = source.indexOf("auth(");
    const ingestAt = source.indexOf("ingestBulkExamFile(");
    assert.ok(authAt >= 0, "route must authenticate with Clerk");
    assert.ok(ingestAt > authAt, "auth must run before ingest");
    assert.match(source, /zipFile/);
    assert.match(source, /userId/);
    assert.match(source, /extractZipPdfs\(/);
    assert.match(source, /collectZipResults\(/);
    assert.doesNotMatch(source, /192\.168\.1\.105/);
    assert.doesNotMatch(source, /NEXT_PUBLIC_/);
  });

  it("reuses the bulk ingest path that records analyzedBy", () => {
    const bulk = readFileSync(BULK_ROUTE, "utf8");
    assert.match(bulk, /export async function ingestBulkExamFile/);
    assert.match(bulk, /analyzedBy:\s*userId/);
    const ownerAt = bulk.indexOf("analyzedBy: userId");
    assert.ok(ownerAt > bulk.indexOf("if (!userId)"), "ingest must refuse a missing owner");
  });
});
