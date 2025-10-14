/**
 * MongoDB Index Creation Script
 * 
 * Run this script to create all necessary indexes for optimal query performance
 * based on the analysis in DATABASE_QUERIES_ANALYSIS.md
 * 
 * Usage:
 *   node create-indexes.js
 * 
 * Or in MongoDB shell:
 *   mongo <database_name> < create-indexes.js
 */

import { connect, disconnect } from './connect.js';
import { 
  getPromptModel, 
  getExamQuestionModel, 
  getExamModel, 
  getExamSubmissionModel, 
  getUserModel 
} from './mongooseSchemas.js';

async function createIndexes() {
  try {
    console.log('Connecting to database...');
    await connect();
    
    const PromptModel = getPromptModel();
    const ExamQuestionModel = getExamQuestionModel();
    const ExamModel = getExamModel();
    const ExamSubmissionModel = getExamSubmissionModel();
    const UserModel = getUserModel();
    
    console.log('\n========================================');
    console.log('Creating Indexes for Prompt Collection');
    console.log('========================================\n');
    
    // Prompt indexes
    await PromptModel.collection.createIndex(
      { subject: 1, topic: 1 },
      { name: 'subject_topic_idx' }
    );
    console.log('✅ Created index: subject_topic_idx');
    
    await PromptModel.collection.createIndex(
      { subject: 1, createdAt: -1 },
      { name: 'subject_createdAt_idx' }
    );
    console.log('✅ Created index: subject_createdAt_idx');
    
    await PromptModel.collection.createIndex(
      { generateVia: 1, ocrConfidence: 1 },
      { name: 'generateVia_ocrConfidence_idx' }
    );
    console.log('✅ Created index: generateVia_ocrConfidence_idx');
    
    await PromptModel.collection.createIndex(
      { subject: 1, topic: 1, bloomsLevel: 1 },
      { name: 'subject_topic_bloomsLevel_idx' }
    );
    console.log('✅ Created index: subject_topic_bloomsLevel_idx');
    
    await PromptModel.collection.createIndex(
      { source: 1 },
      { name: 'source_idx' }
    );
    console.log('✅ Created index: source_idx (for PYQ tracking)');
    
    console.log('\n================================================');
    console.log('Creating Indexes for ExamQuestion Collection');
    console.log('================================================\n');
    
    // ExamQuestion indexes
    await ExamQuestionModel.collection.createIndex(
      { promptId: 1 },
      { name: 'promptId_idx' }
    );
    console.log('✅ Created index: promptId_idx (find all exams using a prompt)');
    
    console.log('\n========================================');
    console.log('Creating Indexes for Exam Collection');
    console.log('========================================\n');
    
    // Exam indexes
    await ExamModel.collection.createIndex(
      { assignedUsers: 1, scheduledAt: -1 },
      { name: 'assignedUsers_scheduledAt_idx' }
    );
    console.log('✅ Created index: assignedUsers_scheduledAt_idx (user dashboard)');
    
    await ExamModel.collection.createIndex(
      { subject: 1, createdBy: 1, createdAt: -1 },
      { name: 'subject_createdBy_createdAt_idx' }
    );
    console.log('✅ Created index: subject_createdBy_createdAt_idx (teacher exam management)');
    
    await ExamModel.collection.createIndex(
      { questions: 1 },
      { name: 'questions_idx' }
    );
    console.log('✅ Created index: questions_idx (exam question lookups)');
    
    await ExamModel.collection.createIndex(
      { createdBy: 1, createdAt: -1 },
      { name: 'createdBy_createdAt_idx' }
    );
    console.log('✅ Created index: createdBy_createdAt_idx (teacher created exams)');
    
    console.log('\n==================================================');
    console.log('Creating Indexes for ExamSubmission Collection');
    console.log('==================================================\n');
    
    // ExamSubmission indexes (MOST CRITICAL)
    await ExamSubmissionModel.collection.createIndex(
      { examId: 1, userId: 1 },
      { unique: true, name: 'examId_userId_unique_idx' }
    );
    console.log('✅ Created UNIQUE index: examId_userId_unique_idx (prevent duplicate submissions)');
    
    await ExamSubmissionModel.collection.createIndex(
      { examId: 1, submittedAt: -1 },
      { name: 'examId_submittedAt_idx' }
    );
    console.log('✅ Created index: examId_submittedAt_idx (grading dashboard)');
    
    await ExamSubmissionModel.collection.createIndex(
      { userId: 1, status: 1, submittedAt: -1 },
      { name: 'userId_status_submittedAt_idx' }
    );
    console.log('✅ Created index: userId_status_submittedAt_idx (user submission history)');
    
    await ExamSubmissionModel.collection.createIndex(
      { _id: 1, status: 1 },
      { name: 'id_status_idx' }
    );
    console.log('✅ Created index: id_status_idx (status-based updates)');
    
    await ExamSubmissionModel.collection.createIndex(
      { userId: 1, evaluatedAt: -1 },
      { name: 'userId_evaluatedAt_idx' }
    );
    console.log('✅ Created index: userId_evaluatedAt_idx (evaluated submissions)');
    
    await ExamSubmissionModel.collection.createIndex(
      { status: 1, startedAt: 1 },
      { name: 'status_startedAt_idx' }
    );
    console.log('✅ Created index: status_startedAt_idx (find stale in-progress submissions)');
    
    console.log('\n========================================');
    console.log('Creating Indexes for User Collection');
    console.log('========================================\n');
    
    // User indexes
    await UserModel.collection.createIndex(
      { email: 1 },
      { unique: true, name: 'email_unique_idx' }
    );
    console.log('✅ Created UNIQUE index: email_unique_idx');
    
    await UserModel.collection.createIndex(
      { currentAllocatedExams: 1 },
      { name: 'currentAllocatedExams_idx' }
    );
    console.log('✅ Created index: currentAllocatedExams_idx (multi-key index for array)');
    
    await UserModel.collection.createIndex(
      { submissionHistory: 1 },
      { name: 'submissionHistory_idx' }
    );
    console.log('✅ Created index: submissionHistory_idx (multi-key index for array)');
    
    await UserModel.collection.createIndex(
      { role: 1, createdAt: -1 },
      { name: 'role_createdAt_idx' }
    );
    console.log('✅ Created index: role_createdAt_idx (admin user management)');
    
    console.log('\n========================================');
    console.log('✅ All indexes created successfully!');
    console.log('========================================\n');
    
    // List all indexes for verification
    console.log('Verifying indexes...\n');
    
    const promptIndexes = await PromptModel.collection.indexes();
    console.log('Prompt indexes:', promptIndexes.length);
    
    const examQuestionIndexes = await ExamQuestionModel.collection.indexes();
    console.log('ExamQuestion indexes:', examQuestionIndexes.length);
    
    const examIndexes = await ExamModel.collection.indexes();
    console.log('Exam indexes:', examIndexes.length);
    
    const submissionIndexes = await ExamSubmissionModel.collection.indexes();
    console.log('ExamSubmission indexes:', submissionIndexes.length);
    
    const userIndexes = await UserModel.collection.indexes();
    console.log('User indexes:', userIndexes.length);
    
    console.log('\n========================================');
    console.log('Index Creation Complete!');
    console.log('========================================');
    
    await disconnect();
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error creating indexes:', error);
    await disconnect();
    process.exit(1);
  }
}

// Run the script
createIndexes();
