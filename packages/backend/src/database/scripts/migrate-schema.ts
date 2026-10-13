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
 * ExamQuestion documents use questionType (MCQ, TEXT, TRUE_FALSE) plus the
 * legacy options, answer, and marks. Exams that already store ExamQuestion
 * ids are skipped, so assignees, createdBy, and deletedAt stay as they are.
 * A failed exam is not rewritten. Re-running upserts the same ExamQuestion ids.
 *
 * Repair for a database already touched by the old script: that run could
 * create Prompt documents, fail ExamQuestion validation, and still print
 * completion. Exams in that state still hold { questionId, marks } entries.
 * Run this script again. It reuses prompts matched by question text and
 * subject. It does not rebuild an exam whose questions array was already
 * replaced with ids.
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
import {
  documentId,
  formatMigrationReport,
  legacyQuestionSource,
  migrationExitCode,
  planExamConversion,
  type MigrationFailure,
  type PromptLink,
} from '../examSchemaMigration.js';

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
async function migrateQuestionsToPrompts(failures: MigrationFailure[]): Promise<Map<string, PromptLink>> {
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
  
  const questionToPromptMap = new Map<string, PromptLink>();
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
      const questionKey = documentId(question._id);
      try {
        const source = legacyQuestionSource(question);
        // Check if already migrated
        const existingPrompt = await PromptModel.findOne({
          questionText: question.text,
          subject: question.subject || 'Unknown'
        });
        
        if (existingPrompt) {
          questionToPromptMap.set(questionKey, {
            promptId: documentId(existingPrompt._id),
            question: source,
          });
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
          questionToPromptMap.set(questionKey, {
            promptId: documentId(savedPrompt._id),
            question: source,
          });
          migrated++;
        } else {
          questionToPromptMap.set(questionKey, {
            promptId: `dry-run:${questionKey}`,
            question: source,
          });
        }
        
        console.log(`  ✅ Migrated question ${question._id} → prompt ${isDryRun ? '[dry-run]' : 'created'}`);
      } catch (error) {
        const message = (error as Error).message;
        console.error(`  ❌ Error migrating question ${question._id}:`, message);
        failures.push({ step: "prompts", id: questionKey || String(question._id), error: message });
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
async function createExamQuestions(
  questionToPromptMap: Map<string, PromptLink>,
  failures: MigrationFailure[]
): Promise<Map<string, string[]>> {
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
  let failed = 0;
  
  while (processed < totalExams) {
    const exams = await ExamModel.find()
      .skip(processed)
      .limit(batchSize)
      .lean();
    
    if (exams.length === 0) break;
    
    for (const exam of exams) {
      const examKey = documentId(exam._id) || String(exam._id);
      const plan = planExamConversion(exam, questionToPromptMap);

      if (plan.status === "skip-empty") {
        console.log(`  ⏭️  Exam ${exam._id} has no questions, skipping...`);
      } else if (plan.status === "skip-migrated") {
        console.log(`  ⏭️  Exam ${exam._id} already references ExamQuestion ids, skipping...`);
      } else if (plan.status === "failed" || !plan.questions || !plan.examUpdate) {
        const error = plan.error ?? "Exam conversion failed";
        console.error(`  ❌ Exam ${exam._id}: ${error}`);
        failures.push({ step: "exam-questions", id: examKey, error });
        failed++;
      } else if (!isDryRun) {
        try {
          for (const examQuestion of plan.questions) {
            // Stable id: a retry overwrites the same document instead of inserting another.
            // save() runs the ExamQuestion validators before the exam is rewritten.
            const id = new Types.ObjectId(examQuestion.id);
            const existing = await ExamQuestionModel.findById(id);
            const doc = existing ?? new ExamQuestionModel({ _id: id });
            doc.overwrite({ _id: id, ...examQuestion.data });
            await doc.save();
          }
          examQuestionMap.set(examKey, plan.examUpdate.questions);
          console.log(`  ✅ Prepared ${plan.questions.length} ExamQuestions for exam ${exam._id}`);
        } catch (error) {
          const message = (error as Error).message;
          console.error(`  ❌ Error saving ExamQuestions for exam ${exam._id}:`, message);
          failures.push({ step: "exam-questions", id: examKey, error: message });
          failed++;
        }
      } else {
        examQuestionMap.set(examKey, plan.examUpdate.questions);
        console.log(`  ✅ Prepared ${plan.questions.length} ExamQuestions for exam ${exam._id}`);
      }
      
      processed++;
    }
    
    console.log(`Progress: ${processed}/${totalExams} exams processed`);
  }
  
  if (failed > 0) {
    console.error(`\n❌ Step 2 finished with ${failed} exam conversion error(s). Those exams were left unchanged.`);
  } else {
    console.log(`\n✅ Step 2 Complete: ExamQuestions prepared for ${examQuestionMap.size} exams`);
  }
  return examQuestionMap;
}

/**
 * Step 3: Update Exam documents with new structure
 */
async function updateExams(
  examQuestionMap: Map<string, string[]>,
  failures: MigrationFailure[]
): Promise<void> {
  console.log('\n[Step 3] Updating Exam documents...\n');
  
  const ExamModel = getExamModel();
  let updated = 0;
  
  for (const [examId, examQuestionIds] of examQuestionMap) {
    try {
      if (!isDryRun) {
        // Only the question references change. Assignees, createdBy, createdAt,
        // and deletedAt stay so a re-run cannot wipe a live or soft-deleted exam.
        await ExamModel.updateOne(
          { _id: examId },
          { $set: { questions: examQuestionIds } }
        );
      }
      
      console.log(`  ✅ Updated exam ${examId} with ${examQuestionIds.length} ExamQuestion IDs`);
      updated++;
      
    } catch (error) {
      const message = (error as Error).message;
      console.error(`  ❌ Error updating exam ${examId}:`, message);
      failures.push({ step: "exams", id: examId, error: message });
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
    const failures: MigrationFailure[] = [];
    
    // Run migration steps
    const questionToPromptMap = await migrateQuestionsToPrompts(failures);
    const examQuestionMap = await createExamQuestions(questionToPromptMap, failures);
    await updateExams(examQuestionMap, failures);
    await updateExamSubmissions();
    
    if (!isDryRun) {
      await verifyMigration();
    }
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    const exitCode = migrationExitCode(failures);
    
    console.log('\n========================================');
    for (const line of formatMigrationReport(failures, isDryRun)) {
      if (exitCode === 0) console.log(line);
      else console.error(line);
    }
    console.log(`Total time: ${duration} seconds`);
    console.log('========================================\n');
    
    if (exitCode === 0 && isDryRun) {
      console.log('This was a dry run. No changes were made to the database.');
      console.log('Run without --dry-run to perform the actual migration.\n');
    } else if (exitCode === 0) {
      console.log('⚠️  IMPORTANT: ');
      console.log('1. Create database indexes by running: ts-node create-indexes.ts');
      console.log('2. Test the new API endpoints thoroughly');
      console.log('3. Update frontend to use new schema structure');
      console.log('4. Keep old Question model for backward compatibility initially\n');
    }
    
    await disconnect();
    process.exit(exitCode);
    
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    await disconnect();
    process.exit(1);
  }
}

// Run the migration
runMigration();
