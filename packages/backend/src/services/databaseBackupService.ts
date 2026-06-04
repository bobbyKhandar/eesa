import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand, _Object } from "@aws-sdk/client-s3";
import { connect } from "../database/connect";
import mongoose from "mongoose";

import {
  getQuestionModel,
  getExamModel,
  getUserModel,
  getExamSubmissionModel,
  getPromptModel,
  getExamQuestionModel,
  getSubjectModel as getLegacySubjectModel,
  getJobMetadataModel,
  getUploadSessionModel
} from "../database/mongooseSchemas";
import {
  getAnalysisReportModel,
  getExamAnalysisModel,
  getPastPaperModel,
  getSyllabusModel,
  getUniqueQuestionModel,
  getSubjectModel
} from "../database/newFeatureModels";

const S3_BACKUP_BUCKET = process.env.S3_BACKUP_BUCKET || process.env.S3_BUCKET || 'eesa-pipeline-storage';
const S3_REGION = process.env.AWS_REGION || 'ap-south-1';
const BACKUP_PREFIX = 'database-backups';

const s3Client = new S3Client({ region: S3_REGION });

interface CollectionInfo {
  name: string;
  model: mongoose.Model<any>;
}

interface BackupMetadata {
  id: string;
  timestamp: string;
  size: number;
  collectionCounts: Record<string, number>;
  totalDocuments: number;
  status: 'completed' | 'failed';
  error?: string;
}

function getAllCollections(): CollectionInfo[] {
  return [
    { name: 'questions', model: getQuestionModel() },
    { name: 'examSets', model: getExamModel() },
    { name: 'user', model: getUserModel() },
    { name: 'ExamSubmission', model: getExamSubmissionModel() },
    { name: 'Prompt', model: getPromptModel() },
    { name: 'ExamQuestion', model: getExamQuestionModel() },
    { name: 'subjects', model: getLegacySubjectModel() },
    { name: 'JobMetadata', model: getJobMetadataModel() },
    { name: 'UploadSession', model: getUploadSessionModel() },
    { name: 'AnalysisReport', model: getAnalysisReportModel() },
    { name: 'ExamAnalysis', model: getExamAnalysisModel() },
    { name: 'PastPaper', model: getPastPaperModel() },
    { name: 'Syllabus', model: getSyllabusModel() },
    { name: 'UniqueQuestion', model: getUniqueQuestionModel() },
    { name: 'Subject', model: getSubjectModel() },
  ];
}

export async function createBackup(): Promise<BackupMetadata> {
  await connect();

  const timestamp = new Date().toISOString();
  const backupId = `backup_${timestamp.replace(/[:.]/g, '-')}`;
  const collectionCounts: Record<string, number> = {};
  const backupData: Record<string, any[]> = {};

  const collections = getAllCollections();

  for (const { name, model } of collections) {
    try {
      const docs = await model.find({}).lean();
      backupData[name] = docs;
      collectionCounts[name] = docs.length;
    } catch (err) {
      collectionCounts[name] = 0;
      backupData[name] = [];
    }
  }

  const totalDocuments = Object.values(collectionCounts).reduce((a, b) => a + b, 0);

  const metadata: BackupMetadata = {
    id: backupId,
    timestamp,
    size: 0,
    collectionCounts,
    totalDocuments,
    status: 'completed',
  };

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

  const prefixes = response.CommonPrefixes || [];
  for (const prefix of prefixes) {
    const folderPrefix = prefix.Prefix || '';
    const id = folderPrefix.replace(BACKUP_PREFIX + '/', '').replace('/', '');

    if (!id) continue;

    try {
      const metaResponse = await s3Client.send(new GetObjectCommand({
        Bucket: S3_BACKUP_BUCKET,
        Key: `${BACKUP_PREFIX}/${id}/metadata.json`,
      }));

      const body = await metaResponse.Body?.transformToString();
      if (body) {
        backupMetadatas.push(JSON.parse(body));
      }
    } catch {
      const contents = response.Contents || [];
      const folderObjects = contents.filter(
        (obj: _Object) => obj.Key?.startsWith(`${BACKUP_PREFIX}/${id}/`)
      );
      const totalSize = folderObjects.reduce((sum: number, obj: _Object) => sum + (obj.Size || 0), 0);

      backupMetadatas.push({
        id,
        timestamp: id.replace('backup_', '').replace(/-/g, ':'),
        size: totalSize,
        collectionCounts: {},
        totalDocuments: 0,
        status: 'completed',
      });
    }
  }

  backupMetadatas.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  return backupMetadatas;
}

export async function getBackup(id: string): Promise<BackupMetadata | null> {
  try {
    const metaResponse = await s3Client.send(new GetObjectCommand({
      Bucket: S3_BACKUP_BUCKET,
      Key: `${BACKUP_PREFIX}/${id}/metadata.json`,
    }));

    const body = await metaResponse.Body?.transformToString();
    return body ? JSON.parse(body) : null;
  } catch {
    return null;
  }
}

export async function restoreBackup(id: string): Promise<{ success: boolean; message: string; collectionCounts: Record<string, number> }> {
  await connect();

  const metaResponse = await s3Client.send(new GetObjectCommand({
    Bucket: S3_BACKUP_BUCKET,
    Key: `${BACKUP_PREFIX}/${id}/data.json`,
  }));

  const body = await metaResponse.Body?.transformToString();
  if (!body) {
    throw new Error('Backup data not found');
  }

  const backupData: Record<string, any[]> = JSON.parse(body);
  const collections = getAllCollections();
  const collectionCounts: Record<string, number> = {};

  for (const { name, model } of collections) {
    const docs = backupData[name];
    if (docs && Array.isArray(docs)) {
      try {
        await model.deleteMany({});
        if (docs.length > 0) {
          await model.insertMany(docs);
        }
        collectionCounts[name] = docs.length;
      } catch (err: any) {
        const batchSize = 100;
        let inserted = 0;
        for (let i = 0; i < docs.length; i += batchSize) {
          const batch = docs.slice(i, i + batchSize);
          await model.insertMany(batch);
          inserted += batch.length;
        }
        collectionCounts[name] = inserted;
      }
    }
  }

  return {
    success: true,
    message: `Restored ${Object.values(collectionCounts).reduce((a, b) => a + b, 0)} documents across ${Object.keys(collectionCounts).length} collections`,
    collectionCounts,
  };
}

export async function deleteBackup(id: string): Promise<{ success: boolean; deletedObjects: number }> {
  const listResponse = await s3Client.send(new ListObjectsV2Command({
    Bucket: S3_BACKUP_BUCKET,
    Prefix: `${BACKUP_PREFIX}/${id}/`,
  }));

  const objects = listResponse.Contents || [];
  if (objects.length === 0) {
    throw new Error(`Backup ${id} not found`);
  }

  await s3Client.send(new DeleteObjectCommand({
    Bucket: S3_BACKUP_BUCKET,
    Key: `${BACKUP_PREFIX}/${id}/metadata.json`,
  }));

  for (const obj of objects as _Object[]) {
    if (obj.Key) {
      await s3Client.send(new DeleteObjectCommand({
        Bucket: S3_BACKUP_BUCKET,
        Key: obj.Key,
      }));
    }
  }

  return {
    success: true,
    deletedObjects: objects.length,
  };
}
