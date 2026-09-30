import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectsCommand, _Object } from "@aws-sdk/client-s3";
import { connect } from "../database/connect";
import { getManagedCollections } from "../database/managedCollectionModels";
import type { ManagedCollection } from "../database/managedCollectionModels";
import { MANAGED_COLLECTION_NAMES } from "../database/managedCollections";
import {
  chunkDocuments,
  formatBackupErrors,
  isValidBackupId,
  planRestore,
  RESTORE_BATCH_SIZE,
  summarizeBackupReads,
} from "./backupPlan";

const S3_BACKUP_BUCKET = process.env.S3_BACKUP_BUCKET || process.env.S3_BUCKET || 'eesa-pipeline-storage';
const S3_REGION = process.env.AWS_REGION || 'ap-south-1';
const BACKUP_PREFIX = 'database-backups';

const s3Client = new S3Client({ region: S3_REGION });

export interface BackupMetadata {
  id: string;
  timestamp: string;
  size: number;
  collectionCounts: Record<string, number>;
  totalDocuments: number;
  status: 'completed' | 'failed';
  error?: string;
}

/** Thrown when the requested backup id is not a backup id produced by this service. */
export class InvalidBackupIdError extends Error {
  constructor(id: string) {
    super(`Invalid backup id: ${id}`);
    this.name = 'InvalidBackupIdError';
  }
}

/** Thrown when the requested backup (or its data payload) does not exist in S3. */
export class BackupNotFoundError extends Error {
  constructor(id: string) {
    super(`Backup ${id} not found`);
    this.name = 'BackupNotFoundError';
  }
}

export function getAllCollections(): ManagedCollection[] {
  return getManagedCollections();
}

export async function createBackup(): Promise<BackupMetadata> {
  await connect();

  const timestamp = new Date().toISOString();
  const backupId = `backup_${timestamp.replace(/[:.]/g, '-')}`;
  const collectionCounts: Record<string, number> = {};
  const backupData: Record<string, any[]> = {};
  const readErrors: Record<string, string> = {};

  const collections = getAllCollections();

  for (const { name, model } of collections) {
    try {
      const docs = await model.find({}).lean();
      backupData[name] = docs;
      collectionCounts[name] = docs.length;
    } catch (err) {
      // Never silently record a failed read as "0 documents": restoring that
      // backup would wipe the collection and insert nothing.
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[DatabaseBackupService] Failed to read ${name}:`, message);
      collectionCounts[name] = 0;
      backupData[name] = [];
      readErrors[name] = message;
    }
  }

  const totalDocuments = Object.values(collectionCounts).reduce((a, b) => a + b, 0);
  const reads = summarizeBackupReads(collectionCounts, backupData, readErrors);

  const metadata: BackupMetadata = {
    id: backupId,
    timestamp,
    size: 0,
    collectionCounts,
    totalDocuments,
    status: reads.status,
  };

  if (reads.status === 'failed') {
    metadata.error = `Backup incomplete, failed to read: ${formatBackupErrors(readErrors)}`;
  }

  const dataJson = JSON.stringify(backupData);
  const sizeBytes = Buffer.byteLength(dataJson, 'utf-8');
  metadata.size = sizeBytes;

  const metadataJson = JSON.stringify(metadata, null, 2);

  await s3Client.send(new PutObjectCommand({
    Bucket: S3_BACKUP_BUCKET,
    Key: `${BACKUP_PREFIX}/${backupId}/data.json`,
    Body: dataJson,
    ContentType: 'application/json',
  }));

  await s3Client.send(new PutObjectCommand({
    Bucket: S3_BACKUP_BUCKET,
    Key: `${BACKUP_PREFIX}/${backupId}/metadata.json`,
    Body: metadataJson,
    ContentType: 'application/json',
  }));

  return metadata;
}

export async function listBackups(): Promise<BackupMetadata[]> {
  const response = await s3Client.send(new ListObjectsV2Command({
    Bucket: S3_BACKUP_BUCKET,
    Prefix: `${BACKUP_PREFIX}/`,
    Delimiter: '/',
  }));

  const backupMetadatas: BackupMetadata[] = [];
  const contents = response.Contents || [];

  const prefixes = response.CommonPrefixes || [];
  for (const prefix of prefixes) {
    const folderPrefix = prefix.Prefix || '';
    const id = folderPrefix.replace(BACKUP_PREFIX + '/', '').replace(/\/$/, '');

    if (!id) continue;

    try {
      const metaResponse = await s3Client.send(new GetObjectCommand({
        Bucket: S3_BACKUP_BUCKET,
        Key: `${BACKUP_PREFIX}/${id}/metadata.json`,
      }));

      const body = await metaResponse.Body?.transformToString();
      if (body) {
        backupMetadatas.push(JSON.parse(body));
        continue;
      }
    } catch {
      // Metadata is missing/unreadable - fall back to the S3 object listing.
    }

    // Fallback: derive what we can from S3 itself. The previous implementation
    // rebuilt the timestamp from the backup id by replacing every "-" with ":",
    // which produces an unparsable date ("2026:09:30T16:57:09:123Z") and made
    // the row sort above every real backup.
    const folderObjects = contents.filter(
      (obj: _Object) => obj.Key?.startsWith(`${BACKUP_PREFIX}/${id}/`)
    );
    const totalSize = folderObjects.reduce((sum: number, obj: _Object) => sum + (obj.Size || 0), 0);
    const lastModified = folderObjects
      .map((obj: _Object) => obj.LastModified)
      .filter((value): value is Date => value instanceof Date)
      .sort((a, b) => b.getTime() - a.getTime())[0];

    backupMetadatas.push({
      id,
      timestamp: lastModified ? lastModified.toISOString() : new Date(0).toISOString(),
      size: totalSize,
      collectionCounts: {},
      totalDocuments: 0,
      status: 'completed',
      error: 'Backup metadata is missing, collection counts are unavailable',
    });
  }

  backupMetadatas.sort((a, b) => {
    const byTimestamp = (b.timestamp || '').localeCompare(a.timestamp || '');
    if (byTimestamp !== 0) return byTimestamp;
    return (b.id || '').localeCompare(a.id || '');
  });

  return backupMetadatas;
}

export async function getBackup(id: string): Promise<BackupMetadata | null> {
  if (!isValidBackupId(id)) {
    throw new InvalidBackupIdError(id);
  }

  try {
    const metaResponse = await s3Client.send(new GetObjectCommand({
      Bucket: S3_BACKUP_BUCKET,
      Key: `${BACKUP_PREFIX}/${id}/metadata.json`,
    }));

    const body = await metaResponse.Body?.transformToString();
    return body ? JSON.parse(body) : null;
  } catch (err) {
    if (isNotFoundError(err)) return null;
    throw err;
  }
}

export interface RestoreResult {
  success: boolean;
  message: string;
  collectionCounts: Record<string, number>;
  errors: Record<string, string>;
}

export async function restoreBackup(id: string): Promise<RestoreResult> {
  if (!isValidBackupId(id)) {
    throw new InvalidBackupIdError(id);
  }

  await connect();

  let body: string | undefined;
  try {
    const dataResponse = await s3Client.send(new GetObjectCommand({
      Bucket: S3_BACKUP_BUCKET,
      Key: `${BACKUP_PREFIX}/${id}/data.json`,
    }));
    body = await dataResponse.Body?.transformToString();
  } catch (err) {
    if (isNotFoundError(err)) throw new BackupNotFoundError(id);
    throw err;
  }

  if (!body) {
    throw new BackupNotFoundError(id);
  }

  const backupData: Record<string, any[]> = JSON.parse(body);
  const plan = planRestore(backupData, MANAGED_COLLECTION_NAMES);
  const models = new Map<string, ManagedCollection['model']>(
    getAllCollections().map(({ name, model }) => [name, model])
  );

  const collectionCounts: Record<string, number> = {};
  const errors: Record<string, string> = {};

  for (const { name, docs, presentInBackup } of plan) {
    const model = models.get(name);
    if (!model) {
      errors[name] = 'No model registered for this collection';
      continue;
    }

    try {
      // Always clear first: a restore must leave the database in the exact
      // state of the backup, including collections missing from the payload.
      await model.deleteMany({});
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[DatabaseBackupService] Failed to clear ${name} during restore:`, message);
      errors[name] = `Failed to clear collection: ${message}`;
      continue;
    }

    if (!presentInBackup) {
      collectionCounts[name] = 0;
      continue;
    }

    if (docs.length === 0) {
      collectionCounts[name] = 0;
      continue;
    }

    let inserted = 0;
    for (const batch of chunkDocuments(docs, RESTORE_BATCH_SIZE)) {
      try {
        // ordered: false keeps a single invalid document from aborting the whole
        // batch (and from re-inserting documents the retry already wrote).
        const result = await model.insertMany(batch, { ordered: false });
        inserted += result?.insertedCount ?? batch.length;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error(`[DatabaseBackupService] Restore batch failed for ${name}:`, message);
        errors[name] = `Failed to insert documents: ${message}`;
      }
    }

    collectionCounts[name] = inserted;
  }

  const totalRestored = Object.values(collectionCounts).reduce((a, b) => a + b, 0);
  const success = Object.keys(errors).length === 0;

  return {
    success,
    message: success
      ? `Restored ${totalRestored} documents across ${Object.keys(collectionCounts).length} collections`
      : `Restored ${totalRestored} documents with errors in ${Object.keys(errors).length} collection(s)`,
    collectionCounts,
    errors,
  };
}

export async function deleteBackup(id: string): Promise<{ success: boolean; deletedObjects: number }> {
  if (!isValidBackupId(id)) {
    throw new InvalidBackupIdError(id);
  }

  const listResponse = await s3Client.send(new ListObjectsV2Command({
    Bucket: S3_BACKUP_BUCKET,
    Prefix: `${BACKUP_PREFIX}/${id}/`,
  }));

  const objects = listResponse.Contents || [];
  if (objects.length === 0) {
    throw new BackupNotFoundError(id);
  }

  const keys = objects
    .map((obj: _Object) => obj.Key)
    .filter((key?: string): key is string => typeof key === 'string' && key.length > 0);

  // S3 accepts up to 1000 keys per DeleteObjects call.
  for (let i = 0; i < keys.length; i += 1000) {
    const chunk = keys.slice(i, i + 1000);
    await s3Client.send(new DeleteObjectsCommand({
      Bucket: S3_BACKUP_BUCKET,
      Delete: {
        Objects: chunk.map((Key) => ({ Key })),
        Quiet: true,
      },
    }));
  }

  return {
    success: true,
    deletedObjects: keys.length,
  };
}

function isNotFoundError(error: any): boolean {
  const status = error?.$metadata?.httpStatusCode;
  return error?.name === 'NoSuchKey' || error?.name === 'NotFound' || status === 404;
}
