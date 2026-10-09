import mongoose from "mongoose"
import { finished } from "node:stream/promises"
import { connect } from "../connect.js"
import { sharedNoteMetadataSchema, validateNoteFile, type SharedNoteMetadata } from "../schemas/sharedNoteSchema.js"

async function notesBucket() {
  await connect()
  if (!mongoose.connection.db) throw new Error("Database is unavailable")
  return new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: "sharedNotes" })
}

function publicNote(file: any) {
  const metadata = sharedNoteMetadataSchema.parse(file.metadata)
  return { id: String(file._id), title: metadata.title, description: metadata.description, subject: metadata.subject, tags: metadata.tags, uploadedBy: metadata.uploadedBy, uploadDate: new Date(file.uploadDate).toISOString(), fileSize: file.length, contentType: metadata.contentType }
}

/** File bytes and validated metadata share MongoDB GridFS storage. No local disk or extra server is required. */
export class SharedNoteRepository {
  private bucketProvider: typeof notesBucket
  constructor(bucketProvider = notesBucket) { this.bucketProvider = bucketProvider }

  async upload(filename: string, bytes: Uint8Array, input: Omit<SharedNoteMetadata, "contentType">) {
    const contentType = validateNoteFile(filename, bytes)
    const metadata = sharedNoteMetadataSchema.parse({ ...input, contentType })
    const bucket = await this.bucketProvider()
    const safeFilename = filename.split(/[\\/]/).pop()!.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 150)
    const upload = bucket.openUploadStream(safeFilename, { metadata })
    try {
      const completion = finished(upload)
      upload.end(Buffer.from(bytes))
      await completion
    } catch (error) {
      await upload.abort().catch(() => {})
      throw error
    }
    const file = await bucket.find({ _id: upload.id }).next()
    if (!file) throw new Error("Upload could not be verified")
    return publicNote(file)
  }

  async list() {
    const bucket = await this.bucketProvider()
    const files = await bucket.find({}).sort({ uploadDate: -1 }).limit(100).toArray()
    return files.filter(file => sharedNoteMetadataSchema.safeParse(file.metadata).success).map(publicNote)
  }

  async download(id: string) {
    if (!/^[a-f\d]{24}$/i.test(id)) return null
    const bucket = await this.bucketProvider()
    const objectId = new mongoose.mongo.ObjectId(id)
    const file = await bucket.find({ _id: objectId }).next()
    if (!file || !sharedNoteMetadataSchema.safeParse(file.metadata).success) return null
    const chunks: Buffer[] = []
    for await (const chunk of bucket.openDownloadStream(objectId)) chunks.push(Buffer.from(chunk))
    return { note: publicNote(file), filename: file.filename, bytes: Buffer.concat(chunks) }
  }
}
