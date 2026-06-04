import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connect } from '@/backend/src/database/connect';
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
} from '@/backend/src/database/mongooseSchemas';
import {
  getAnalysisReportModel,
  getExamAnalysisModel,
  getPastPaperModel,
  getSyllabusModel,
  getUniqueQuestionModel,
  getSubjectModel
} from '@/backend/src/database/newFeatureModels';

export async function GET() {
  try {
    await connect();

    const collections = [
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

    const collectionStats: Array<{ name: string; documents: number }> = [];
    let totalDocuments = 0;

    for (const { name, model } of collections) {
      try {
        const count = await model.countDocuments({});
        collectionStats.push({ name, documents: count });
        totalDocuments += count;
      } catch {
        collectionStats.push({ name, documents: 0 });
      }
    }

    let dbStats: Record<string, any> = {};
    try {
      dbStats = await mongoose.connection.db?.stats() || {};
    } catch {
      dbStats = {};
    }

    const connectionStatus = ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoose.connection.readyState] || 'unknown';
    const dataSizeFormatted = formatBytes(dbStats.dataSize || 0);

    return NextResponse.json({
      success: true,
      data: {
        stats: {
          totalCollections: collections.length,
          totalDocuments,
          databaseSize: dataSizeFormatted,
          databaseSizeBytes: dbStats.dataSize || 0,
          connectionStatus,
          host: mongoose.connection.host || 'unknown',
          dbName: mongoose.connection.name || 'unknown',
        },
        collections: collectionStats,
      },
    });
  } catch (error: any) {
    console.error('Error fetching database stats:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch database stats' },
      { status: 500 }
    );
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + units[i];
}
