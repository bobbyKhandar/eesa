/**
 * Turn a bulk-upload ZIP into the per-file status rows the analyze page stores.
 *
 * The page POSTs one archive to /api/exam-analysis/upload-bulk-zip and expects
 * `results` in the same shape as the single-PDF progress list. Extraction stays
 * here so the limits and zip-slip checks can be tested without Next or the database.
 */
import JSZip from "jszip";
import {
  markError,
  markSuccess,
  mergeSplitSubjects,
  type SplitAnalysis,
  type UploadExtractedMetadata,
  type UploadStatus,
} from "./bulkUploadStatus";

export interface ZipLimits {
  maxEntries: number;
  maxPdfs: number;
  maxPdfBytes: number;
  maxTotalBytes: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntries: 500,
  maxPdfs: 100,
  maxPdfBytes: 100 * 1024 * 1024,
  maxTotalBytes: 500 * 1024 * 1024,
};

export interface ZipEntryInfo {
  /** Original archive path, including any unsafe `..` segments. */
  name: string;
  dir: boolean;
  uncompressedSize: number;
}

export interface PlannedZipPdf {
  entryName: string;
  fileName: string;
}

export type ZipPlan =
  | { ok: true; pdfs: PlannedZipPdf[] }
  | { ok: false; error: string };

export interface ExtractedZipPdf {
  fileName: string;
  bytes: Uint8Array;
}

export type ZipExtractResult =
  | { ok: true; files: ExtractedZipPdf[] }
  | { ok: false; error: string };

export interface BulkUploadBody {
  success?: boolean;
  error?: string;
  analysisId?: string;
  multipleSubjects?: boolean;
  analyses?: SplitAnalysis[];
  extractedMetadata?: UploadExtractedMetadata;
}

const ZIP_MIME_TYPES = new Set(["application/zip", "application/x-zip-compressed"]);

export function isZipUpload(file: { name: string; type?: string }): boolean {
  const name = file.name.trim().toLowerCase();
  const type = (file.type ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  return name.endsWith(".zip") || ZIP_MIME_TYPES.has(type);
}

/**
 * Decide which archive members are safe PDFs. Names with `..`, absolute paths,
 * or AppleDouble metadata are skipped so a member cannot choose its output path.
 */
export function planZipPdfs(entries: ZipEntryInfo[], limits: ZipLimits = DEFAULT_ZIP_LIMITS): ZipPlan {
  if (entries.length > limits.maxEntries) {
    return { ok: false, error: `ZIP contains more than ${limits.maxEntries} entries` };
  }

  const usedNames = new Map<string, number>();
  const pdfs: PlannedZipPdf[] = [];
  let totalBytes = 0;

  for (const entry of entries) {
    if (entry.dir) continue;
    const fileName = pdfBaseName(entry.name);
    if (!fileName) continue;

    if (entry.uncompressedSize > limits.maxPdfBytes) {
      return {
        ok: false,
        error: `${fileName} exceeds the ${formatBytes(limits.maxPdfBytes)} uncompressed limit`,
      };
    }

    totalBytes += entry.uncompressedSize;
    if (totalBytes > limits.maxTotalBytes) {
      return {
        ok: false,
        error: `ZIP uncompressed contents exceed the ${formatBytes(limits.maxTotalBytes)} limit`,
      };
    }

    pdfs.push({ entryName: entry.name, fileName: uniquePdfName(fileName, usedNames) });
  }

  if (pdfs.length > limits.maxPdfs) {
    return { ok: false, error: `ZIP contains more than ${limits.maxPdfs} PDF files` };
  }
  if (pdfs.length === 0) {
    return { ok: false, error: "No PDF files found in the ZIP" };
  }
  return { ok: true, pdfs };
}

export async function extractZipPdfs(
  data: Uint8Array,
  limits: ZipLimits = DEFAULT_ZIP_LIMITS
): Promise<ZipExtractResult> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    return { ok: false, error: "Invalid ZIP file" };
  }

  const entries: ZipEntryInfo[] = Object.values(zip.files).map((file) => ({
    name: file.unsafeOriginalName || file.name,
    dir: file.dir,
    uncompressedSize: uncompressedSizeOf(file),
  }));

  const plan = planZipPdfs(entries, limits);
  if (!plan.ok) return plan;

  const files: ExtractedZipPdf[] = [];
  for (const pdf of plan.pdfs) {
    const stored = zip.file(storedZipName(pdf.entryName));
    if (!stored || stored.dir) {
      return { ok: false, error: `Missing ZIP entry ${pdf.fileName}` };
    }
    const bytes = await stored.async("uint8array");
    if (bytes.byteLength > limits.maxPdfBytes) {
      return {
        ok: false,
        error: `${pdf.fileName} exceeds the ${formatBytes(limits.maxPdfBytes)} uncompressed limit`,
      };
    }
    files.push({ fileName: pdf.fileName, bytes });
  }

  return { ok: true, files };
}

/** Map one upload-bulk JSON body onto the status rows the bulk page renders. */
export function statusesFromBulkResponse(
  fileName: string,
  body: BulkUploadBody | null
): UploadStatus[] {
  const seed: UploadStatus[] = [{ fileName, status: "uploading" }];
  if (body?.multipleSubjects && Array.isArray(body.analyses)) {
    return mergeSplitSubjects(seed, 0, fileName, body.analyses);
  }
  if (body?.success && typeof body.analysisId === "string" && body.analysisId.length > 0) {
    return markSuccess(seed, 0, body.analysisId, body.extractedMetadata);
  }
  return markError(seed, 0, body?.error || "Upload failed");
}

/**
 * Ingest each extracted PDF. One failure is recorded on that row and the rest
 * of the archive still runs, matching the one-by-one PDF uploader.
 */
export async function collectZipResults(
  files: ExtractedZipPdf[],
  ingest: (file: File) => Promise<BulkUploadBody | null>
): Promise<UploadStatus[]> {
  const results: UploadStatus[] = [];
  for (const entry of files) {
    if (entry.bytes.byteLength === 0) {
      results.push(
        ...statusesFromBulkResponse(entry.fileName, { success: false, error: "PDF is empty" })
      );
      continue;
    }

    try {
      const file = new File([entry.bytes], entry.fileName, { type: "application/pdf" });
      const body = await ingest(file);
      results.push(...statusesFromBulkResponse(entry.fileName, body));
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : "Upload failed";
      results.push(
        ...statusesFromBulkResponse(entry.fileName, { success: false, error: message })
      );
    }
  }
  return results;
}

function pdfBaseName(entryName: string): string | null {
  const normalized = entryName.replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || normalized.includes("\0")) return null;

  const parts = normalized.split("/");
  if (parts.some((part) => part === ".." || part === ".")) return null;
  if (parts[0] === "__MACOSX") return null;

  const base = parts[parts.length - 1]?.trim() ?? "";
  if (!base || base.startsWith(".") || base.startsWith("._")) return null;
  if (!base.toLowerCase().endsWith(".pdf")) return null;
  return base;
}

function uniquePdfName(fileName: string, usedNames: Map<string, number>): string {
  const key = fileName.toLowerCase();
  const seen = usedNames.get(key) ?? 0;
  usedNames.set(key, seen + 1);
  if (seen === 0) return fileName;
  return fileName.replace(/\.pdf$/i, `-${seen + 1}.pdf`);
}

function uncompressedSizeOf(file: JSZip.JSZipObject): number {
  const data = (file as unknown as { _data?: { uncompressedSize?: number } })._data;
  return typeof data?.uncompressedSize === "number" && data.uncompressedSize >= 0
    ? data.uncompressedSize
    : 0;
}

/** JSZip stores loaded entries under a resolved path, without `..` segments. */
function storedZipName(entryName: string): string {
  const parts = entryName.replace(/\\/g, "/").split("/");
  const resolved: string[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part === "." || (part === "" && index !== 0 && index !== parts.length - 1)) continue;
    if (part === "..") resolved.pop();
    else resolved.push(part);
  }
  return resolved.join("/");
}

function formatBytes(bytes: number): string {
  const mb = 1024 * 1024;
  if (bytes % mb === 0) return `${bytes / mb} MB`;
  return `${bytes} bytes`;
}
