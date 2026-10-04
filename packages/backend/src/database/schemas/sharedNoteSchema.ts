import { z } from "../zodGlobal.ts"

export const sharedNoteMetadataSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(120),
  description: z.string().trim().max(2000),
  subject: z.string().trim().min(1, "Subject is required").max(120),
  tags: z.array(z.string().trim().min(1).max(50)).max(10),
  ownerId: z.string().min(1),
  uploadedBy: z.string().min(1).max(120),
  contentType: z.enum(["application/pdf", "text/plain"]),
})
export type SharedNoteMetadata = z.infer<typeof sharedNoteMetadataSchema>
export const MAX_NOTE_BYTES = 10 * 1024 * 1024

export function validateNoteFile(filename: string, bytes: Uint8Array): "application/pdf" | "text/plain" {
  if (!bytes.length) throw new Error("Choose a non-empty file.")
  if (bytes.length > MAX_NOTE_BYTES) throw new Error("Files must be 10 MB or smaller.")
  if (/\.pdf$/i.test(filename) && Buffer.from(bytes.subarray(0, 5)).toString("ascii") === "%PDF-") return "application/pdf"
  if (/\.txt$/i.test(filename)) {
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw new Error("Binary text")
      return "text/plain"
    } catch { throw new Error("Text files must contain valid UTF-8 text.") }
  }
  throw new Error("Choose a valid PDF or UTF-8 text file.")
}
