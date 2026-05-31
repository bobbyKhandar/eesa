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
  getSubjectModel,
  getJobMetadataModel,
  getUploadSessionModel
} from '@/backend/src/database/mongooseSchemas';
import {
  getAnalysisReportModel,
  getExamAnalysisModel,
  getPastPaperModel,
  getSyllabusModel,
  getUniqueQuestionModel
} from '@/backend/src/database/newFeatureModels';

/**
 * POST /api/admin/database/truncate
 * Truncates (deletes all data from) all collections in the database
 * 
 * This is a dangerous operation that should only be accessible to administrators
 * with proper authentication and authorization checks
 */
export async function POST(request: NextRequest) {
  try {
    // TODO: Add authentication check here
    // const session = await getServerSession(authOptions);
    // if (!session || session.user.role !== 'admin') {
    //   return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    // }

    console.log('🗑️ Starting database truncation...');
    
    // Connect to database
    await connect();
    
    console.log('✓ Connected to database');

    // Get all models
    const QuestionModel = getQuestionModel();
    const ExamModel = getExamModel();
    const UserModel = getUserModel();
    const ExamSubmissionModel = getExamSubmissionModel();
    const PromptModel = getPromptModel();
    const ExamQuestionModel = getExamQuestionModel();
    const SubjectModel = getSubjectModel();
    const JobMetadataModel = getJobMetadataModel();
    const UploadSessionModel = getUploadSessionModel();
    
    // New feature models
    const AnalysisReportModel = getAnalysisReportModel();
    const ExamAnalysisModel = getExamAnalysisModel();
    const PastPaperModel = getPastPaperModel();
    const SyllabusModel = getSyllabusModel();
    const UniqueQuestionModel = getUniqueQuestionModel();

    // Track deletion results
    const deletionResults: Record<string, { before: number; deleted: number; error?: string }> = {};

    // Delete all documents from each collection
    const collections = [
      { name: 'questions', model: QuestionModel },
      { name: 'examSets', model: ExamModel },
      { name: 'user', model: UserModel },
      { name: 'ExamSubmission', model: ExamSubmissionModel },
      { name: 'Prompt', model: PromptModel },
      { name: 'ExamQuestion', model: ExamQuestionModel },
      { name: 'subjects', model: SubjectModel },
      { name: 'JobMetadata', model: JobMetadataModel },
      { name: 'UploadSession', model: UploadSessionModel },
      { name: 'AnalysisReport', model: AnalysisReportModel },
      { name: 'ExamAnalysis', model: ExamAnalysisModel },
      { name: 'PastPaper', model: PastPaperModel },
      { name: 'Syllabus', model: SyllabusModel },
      { name: 'UniqueQuestion', model: UniqueQuestionModel },
    ];

    console.log(`📋 Processing ${collections.length} collections...`);

    // Execute deletions sequentially with logging
    for (const { name, model } of collections) {
      try {
        // Count before deletion
        const countBefore = await model.countDocuments({});
        console.log(`  📊 ${name}: ${countBefore} documents`);
        
        // Delete all documents
        const result = await model.deleteMany({});
        const deletedCount = result.deletedCount || 0;
        
        deletionResults[name] = {
          before: countBefore,
          deleted: deletedCount
        };
        
        console.log(`  ✓ ${name}: Deleted ${deletedCount} documents`);
      } catch (error) {
        console.error(`  ✗ Error deleting from ${name}:`, error);
        deletionResults[name] = {
          before: 0,
          deleted: 0,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    }

    // Calculate totals
    const totalDeleted = Object.values(deletionResults).reduce((sum, result) => sum + result.deleted, 0);
    const hasErrors = Object.values(deletionResults).some(result => result.error);

    console.log(`✅ Truncation complete: ${totalDeleted} total documents deleted`);

    if (hasErrors) {
      return NextResponse.json(
        {
          error: 'Some collections encountered errors',
          details: deletionResults,
          totalDeleted,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      message: `Database truncated successfully - ${totalDeleted} documents deleted`,
      deletedRecords: deletionResults,
      totalDeleted,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('Database truncation error:', error);
    return NextResponse.json(
      {
        error: 'Failed to truncate database',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
