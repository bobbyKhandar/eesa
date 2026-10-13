import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectsCommand, _Object } from "@aws-sdk/client-s3";
import mongoose from "mongoose";
import type { Model } from "mongoose";
import { connect } from "../database/connect";
import { getManagedCollections } from "../database/managedCollectionModels";
import type { ManagedCollection } from "../database/managedCollectionModels";
import { MANAGED_COLLECTION_NAMES } from "../database/managedCollections";
import {
  assessBackupRestore,
  chunkDocuments,
  formatBackupErrors,
  isValidBackupId,
  planRestore,
  RESTORE_BATCH_SIZE,
  summarizeBackupReads,
} from "./backupPlan";
import {
  applyStagedRestore,
  createRestoreToken,
  createStagedRestoreOps,
  toRestoreResult,
  type RestoreCollectionBinding,
  type RestoreDatabase,
} from "./stagedRestore";

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

/**
 * Thrown when a backup must not be applied.
 * Failed backups store unreadable collections as empty arrays; restoring them
 * would delete the live data and insert nothing.
 */
export class BackupNotRestorableError extends Error {
  readonly backupId: string;

  constructor(id: string, reason?: string) {
    const detail = typeof reason === 'string' ? reason.trim() : '';
    super(
      detail.length > 0
        ? `Cannot restore backup ${id}: ${detail}`
        : `Cannot restore backup ${id}: backup is incomplete`
    );
    this.name = 'BackupNotRestorableError';
    this.backupId = id;
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
      // Keep the failed read in the payload so the backup still shows what was
      // captured, but mark the backup failed. restoreBackup refuses that status
      // before deleting anything: applying this payload would wipe the collection
      // and insert nothing.
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

  // A failed backup recorded unreadable collections as empty arrays. Check that
  // before connecting or deleting, so a refused restore leaves live data intact.
  const metadata = await getBackup(id);
  const decision = assessBackupRestore(metadata);
  if (!decision.allowed) {
    throw new BackupNotRestorableError(id, decision.reason);
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
  const database = mongoose.connection.db as RestoreDatabase | undefined;
  if (!database) {
    throw new Error('Database connection is not ready');
  }

  const models = new Map<string, ManagedCollection['model']>(
    getAllCollections().map(({ name, model }) => [name, model])
  );
  // Stage every collection, then rename it into place. Deleting first and
  // inserting afterwards drops live documents when a later batch fails.
  const bindings = plan.map((entry) =>
    bindingForCollection(entry.name, models.get(entry.name))
  );
  const outcome = await applyStagedRestore(
    plan,
    createStagedRestoreOps(database, bindings, createRestoreToken())
  );
  if (!outcome.applied) {
    console.error(
      outcome.liveDataPreserved
        ? '[DatabaseBackupService] Restore failed; live data was left unchanged:'
        : '[DatabaseBackupService] Restore failed and could not fully roll back live data:',
      outcome.errors
    );
  }
  return toRestoreResult(outcome);
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

function bindingForCollection(
  name: string,
  model: Model<any> | undefined
): RestoreCollectionBinding {
  // Registry keys are not always the MongoDB collection. Subject is stored in
  // featureSubjects; renaming the registry key would miss the live data.
  const physicalName = model?.collection.collectionName || name;
  return {
    name,
    physicalName,
    validate: async (docs) => {
      if (!model) throw new Error('No model registered for this collection');
      await validateBackupDocuments(model, docs);
    },
    insertInto: async (stagingCollection, docs) => {
      if (!model) throw new Error('No model registered for this collection');
      return insertIntoStagingCollection(model, stagingCollection, docs);
    },
  };
}

async function validateBackupDocuments(model: Model<any>, docs: unknown[]): Promise<void> {
  for (let index = 0; index < docs.length; index += 1) {
    const doc = docs[index];
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
      throw new Error(`Document ${index} is not an object`);
    }
    try {
      await new model(doc).validate();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Document ${index} failed validation: ${message}`);
    }
  }
}

async function insertIntoStagingCollection(
  model: Model<any>,
  stagingCollection: string,
  docs: unknown[]
): Promise<number> {
  const schema = model.schema.clone();
  schema.set('autoIndex', false);
  schema.set('autoCreate', false);
  const modelName = `EesaRestoreStaging_${stagingCollection.replace(/[^A-Za-z0-9]/g, '_')}`;
  const stagingModel = mongoose.model(modelName, schema, stagingCollection);
  try {
    let inserted = 0;
    for (const batch of chunkDocuments(docs, RESTORE_BATCH_SIZE)) {
      const result = await stagingModel.insertMany(batch, { ordered: true });
      inserted += Array.isArray(result) ? result.length : batch.length;
    }
    if (inserted !== docs.length) {
      throw new Error(`Staged ${inserted} of ${docs.length} documents`);
    }
    return inserted;
  } finally {
    mongoose.deleteModel(modelName);
  }
}

function isNotFoundError(error: any): boolean {
  const status = error?.$metadata?.httpStatusCode;
  return error?.name === 'NoSuchKey' || error?.name === 'NotFound' || status === 404;
}
