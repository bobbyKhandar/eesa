/**
 * Schema Migration Script
 * 
 * Migrates existing data from old schema (Question-based) to new schema (Prompt + ExamQuestion)
 * 
 * Migration Steps:
 * 1. Copy existing questions to Prompt collection (with generateVia: 'user')
 * 2. Create ExamQuestion instances for each exam's questions
 * 3. Update Exam documents with ExamQuestion IDs
 * 4. Update ExamSubmission documents (email → userId)
 * 5. Verify data integrity
 * 
 * Usage:
 *   ts-node migrate-schema.ts [--dry-run] [--batch-size=100]
 *   OR
 *   npx tsx migrate-schema.ts [--dry-run] [--batch-size=100]
 * 
 * Options:
 *   --dry-run      Show what would be migrated without making changes
 *   --batch-size   Number of records to process per batch (default: 100)
 */

import { connect, disconnect } from '../connect.js';
import { 
  getQuestionModel,
  getPromptModel, 
  getExamQuestionModel, 
  getExamModel, 
  getExamSubmissionModel, 
  getUserModel 
} from '../mongooseSchemas.js';
import { Types } from 'mongoose';

// Parse command line arguments
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const batchSizeArg = args.find(arg => arg.startsWith('--batch-size='));
const batchSize = batchSizeArg ? parseInt(batchSizeArg.split('=')[1]) : 100;

console.log('\n========================================');
console.log('Schema Migration Script');
console.log('========================================');
console.log(`Mode: ${isDryRun ? 'DRY RUN (no changes will be made)' : 'LIVE MIGRATION'}`);
console.log(`Batch Size: ${batchSize}`);
console.log('========================================\n');

/**
 * Step 1: Migrate Questions to Prompts
 */
async function migrateQuestionsToPrompts(): Promise<Map<string, string>> {
  console.log('\n[Step 1] Migrating Questions to Prompts...\n');
  
  const QuestionModel = getQuestionModel();
  const PromptModel = getPromptModel();
  
  // Get total count
  const totalQuestions = await QuestionModel.countDocuments();
  console.log(`Found ${totalQuestions} questions to migrate`);
  
  if (totalQuestions === 0) {
    console.log('No questions to migrate, skipping...');
    return new Map();
  }
  
  const questionToPromptMap = new Map<string, string>(); // Maps old question ID to new prompt ID
  let processed = 0;
  let migrated = 0;
  
  // Process in batches
  while (processed < totalQuestions) {
    const questions = await QuestionModel.find()
      .skip(processed)
      .limit(batchSize)
      .lean();
    
    if (questions.length === 0) break;
    
    for (const question of questions) {
      try {
        // Check if already migrated
        const existingPrompt = await PromptModel.findOne({
          questionText: question.text,
          subject: question.subject || 'Unknown'
        });
        
        if (existingPrompt) {
          questionToPromptMap.set(question._id.toString(), existingPrompt._id.toString());
          console.log(`  ⏭️  Question ${question._id} already migrated, skipping...`);
          processed++;
          continue;
        }
        
        // Create prompt from question
        const promptData = {
          questionText: question.text,
          subject: question.subject || 'Unknown',
          topic: question.topic || undefined,
          generateVia: 'user' as const, // Existing questions are user-created
          createdBy: question.createdBy || 'system', // Fallback to system if no creator
          bloomsLevel: question.bloomsLevel || undefined,
          createdAt: question.createdAt || new Date()
        };
        
        if (!isDryRun) {
          const prompt = new PromptModel(promptData);
          const savedPrompt = await prompt.save();
          questionToPromptMap.set(question._id.toString(), savedPrompt._id.toString());
          migrated++;
        }
        
        console.log(`  ✅ Migrated question ${question._id} → prompt ${isDryRun ? '[dry-run]' : 'created'}`);
      } catch (error) {
        console.error(`  ❌ Error migrating question ${question._id}:`, (error as Error).message);
      }
      
      processed++;
    }
    
    console.log(`Progress: ${processed}/${totalQuestions} questions processed`);
  }
  
  console.log(`\n✅ Step 1 Complete: ${migrated} prompts created`);
  return questionToPromptMap;
}

/**
 * Step 2: Create ExamQuestions for each Exam
 */
async function createExamQuestions(questionToPromptMap: Map<string, string>): Promise<Map<string, string[]>> {
  console.log('\n[Step 2] Creating ExamQuestion instances...\n');
  
  const ExamModel = getExamModel();
  const ExamQuestionModel = getExamQuestionModel();
  
  const totalExams = await ExamModel.countDocuments();
  console.log(`Found ${totalExams} exams to process`);
  
  if (totalExams === 0) {
    console.log('No exams to process, skipping...');
    return new Map();
  }
  
  const examQuestionMap = new Map<string, string[]>(); // Maps exam ID to array of ExamQuestion IDs
  let processed = 0;
  
  while (processed < totalExams) {
    const exams = await ExamModel.find()
      .skip(processed)
      .limit(batchSize)
      .lean();
    
    if (exams.length === 0) break;
    
    for (const exam of exams) {
      try {
        const examQuestionIds: string[] = [];
        
        if (!exam.questions || exam.questions.length === 0) {
          console.log(`  ⏭️  Exam ${exam._id} has no questions, skipping...`);
          processed++;
          continue;
        }
        
        for (const examQuestion of exam.questions) {
          const oldQuestionId = examQuestion.questionId.toString();
          const promptId = questionToPromptMap.get(oldQuestionId);
          
          if (!promptId) {
            console.error(`  ⚠️  No prompt found for question ${oldQuestionId} in exam ${exam._id}`);
            continue;
          }
          
          // Create ExamQuestion
          const examQuestionData = {
            promptId: promptId,
            marks: examQuestion.marks || 1,
            negativeMarks: exam.negativeMarking ? (examQuestion.marks * 0.25) : 0,
            answerType: 'mcq' as const, // Default, adjust based on your data
            options: [], // Would need to be populated from original question
            createdAt: new Date()
          };
          
          if (!isDryRun) {
            const newExamQuestion = new ExamQuestionModel(examQuestionData);
            const savedExamQuestion = await newExamQuestion.save();
            examQuestionIds.push(savedExamQuestion._id.toString());
          } else {
            examQuestionIds.push('[dry-run-id]');
          }
        }
        
        examQuestionMap.set(exam._id.toString(), examQuestionIds);
        console.log(`  ✅ Created ${examQuestionIds.length} ExamQuestions for exam ${exam._id}`);
        
      } catch (error) {
        console.error(`  ❌ Error processing exam ${exam._id}:`, (error as Error).message);
      }
      
      processed++;
    }
    
    console.log(`Progress: ${processed}/${totalExams} exams processed`);
  }
  
  console.log(`\n✅ Step 2 Complete: ExamQuestions created for ${examQuestionMap.size} exams`);
  return examQuestionMap;
}

/**
 * Step 3: Update Exam documents with new structure
 */
async function updateExams(examQuestionMap: Map<string, string[]>): Promise<void> {
  console.log('\n[Step 3] Updating Exam documents...\n');
  
  const ExamModel = getExamModel();
  let updated = 0;
  
  for (const [examId, examQuestionIds] of examQuestionMap) {
    try {
      if (!isDryRun) {
        await ExamModel.updateOne(
          { _id: examId },
          {
            $set: {
              questions: examQuestionIds,
              assignedUsers: [], // Initialize empty, would need manual assignment
              createdBy: 'system', // Fallback
              createdAt: new Date()
            }
          }
        );
      }
      
      console.log(`  ✅ Updated exam ${examId} with ${examQuestionIds.length} ExamQuestion IDs`);
      updated++;
      
    } catch (error) {
      console.error(`  ❌ Error updating exam ${examId}:`, (error as Error).message);
    }
  }
  
  console.log(`\n✅ Step 3 Complete: ${updated} exams updated`);
}

/**
 * Step 4: Update ExamSubmissions (email → userId)
 */
async function updateExamSubmissions(): Promise<void> {
  console.log('\n[Step 4] Updating ExamSubmission documents...\n');
  
  const ExamSubmissionModel = getExamSubmissionModel();
  const UserModel = getUserModel();
  
  const totalSubmissions = await ExamSubmissionModel.countDocuments();
  console.log(`Found ${totalSubmissions} submissions to update`);
  
  if (totalSubmissions === 0) {
    console.log('No submissions to update, skipping...');
    return;
  }
  
  let processed = 0;
  let updated = 0;
  
  while (processed < totalSubmissions) {
    const submissions = await ExamSubmissionModel.find()
      .skip(processed)
      .limit(batchSize)
      .lean();
    
    if (submissions.length === 0) break;
    
    for (const submission of submissions) {
      try {
        // Skip if already has userId
        if (submission.userId) {
          console.log(`  ⏭️  Submission ${submission._id} already has userId, skipping...`);
          processed++;
          continue;
        }
        
        // Find user by email
        const user = await UserModel.findOne({ email: submission.studentEmail });
        
        if (!user) {
          console.error(`  ⚠️  No user found for email ${submission.studentEmail}`);
          processed++;
          continue;
        }
        
        // Update submission with userId
        if (!isDryRun) {
          await ExamSubmissionModel.updateOne(
            { _id: submission._id },
            {
              $set: {
                userId: user._id.toString(),
                status: submission.evaluated ? 'EVALUATED' as const : 
                       submission.submittedAt ? 'SUBMITTED' as const : 'IN_PROGRESS' as const,
                responses: [] // Would need to be populated from answers field
              }
            }
          );
        }
        
        console.log(`  ✅ Updated submission ${submission._id} with userId ${user._id}`);
        updated++;
        
      } catch (error) {
        console.error(`  ❌ Error updating submission ${submission._id}:`, (error as Error).message);
      }
      
      processed++;
    }
    
    console.log(`Progress: ${processed}/${totalSubmissions} submissions processed`);
  }
  
  console.log(`\n✅ Step 4 Complete: ${updated} submissions updated`);
}

/**
 * Step 5: Verify data integrity
 */
async function verifyMigration(): Promise<void> {
  console.log('\n[Step 5] Verifying migration...\n');
  
  const PromptModel = getPromptModel();
  const ExamQuestionModel = getExamQuestionModel();
  const ExamModel = getExamModel();
  const ExamSubmissionModel = getExamSubmissionModel();
  
  const promptCount = await PromptModel.countDocuments();
  const examQuestionCount = await ExamQuestionModel.countDocuments();
  const examCount = await ExamModel.countDocuments();
  const submissionCount = await ExamSubmissionModel.countDocuments();
  
  console.log('Migration Statistics:');
  console.log(`  - Prompts: ${promptCount}`);
  console.log(`  - ExamQuestions: ${examQuestionCount}`);
  console.log(`  - Exams: ${examCount}`);
  console.log(`  - Submissions: ${submissionCount}`);
  
  // Check for orphaned records
  const allPromptIds = (await PromptModel.distinct('_id')).map(id => id.toString());
  const orphanedExamQuestions = await ExamQuestionModel.countDocuments({
    promptId: { $nin: allPromptIds }
  });
  
  if (orphanedExamQuestions > 0) {
    console.warn(`  ⚠️  Found ${orphanedExamQuestions} orphaned ExamQuestions (no matching Prompt)`);
  } else {
    console.log('  ✅ No orphaned ExamQuestions found');
  }
  
  console.log('\n✅ Step 5 Complete: Verification done');
}

/**
 * Main migration function
 */
async function runMigration(): Promise<void> {
  try {
    console.log('Connecting to database...\n');
    await connect();
    
    const startTime = Date.now();
    
    // Run migration steps
    const questionToPromptMap = await migrateQuestionsToPrompts();
    const examQuestionMap = await createExamQuestions(questionToPromptMap);
    await updateExams(examQuestionMap);
    await updateExamSubmissions();
    
    if (!isDryRun) {
      await verifyMigration();
    }
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log('\n========================================');
    console.log(`✅ Migration ${isDryRun ? '(DRY RUN) ' : ''}Complete!`);
    console.log(`Total time: ${duration} seconds`);
    console.log('========================================\n');
    
    if (isDryRun) {
      console.log('This was a dry run. No changes were made to the database.');
      console.log('Run without --dry-run to perform the actual migration.\n');
    } else {
      console.log('⚠️  IMPORTANT: ');
      console.log('1. Create database indexes by running: ts-node create-indexes.ts');
      console.log('2. Test the new API endpoints thoroughly');
      console.log('3. Update frontend to use new schema structure');
      console.log('4. Keep old Question model for backward compatibility initially\n');
    }
    
    await disconnect();
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    await disconnect();
    process.exit(1);
  }
}

// Run the migration
runMigration();
