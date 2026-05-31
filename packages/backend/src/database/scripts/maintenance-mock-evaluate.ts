/**
 * MAINTENANCE SCRIPT — TESTING ONLY, NOT FOR PRODUCTION USE
 *
 * Simulates a student submitting an exam. Uses the real AI evaluator
 * (Bedrock DeepSeek-R1 via evaluateExamResponses) to grade answers.
 *
 * Flow:
 *   1. Fetches the exam with question + prompt details
 *   2. Generates plausible student answers per question
 *   3. Sends to evaluateExamResponses() for AI grading
 *   4. Creates a submission record with AI-evaluated scores
 *   5. Auto-moves the exam from currentAllocatedExams → submissionHistory
 *
 * Usage:
 *   npx tsx src/database/scripts/maintenance-mock-evaluate.ts --email bobby.k@somaiya.edu --first
 *   npx tsx src/database/scripts/maintenance-mock-evaluate.ts --email bobby.k@somaiya.edu --all
 *   npx tsx src/database/scripts/maintenance-mock-evaluate.ts <userId> <examId>
 *
 * Flags:
 *   --email <email>    Look up user by email instead of userId
 *   --exam-id <id>     ID of the exam to submit
 *   --first            Submit the first exam allocated to the user
 *   --all              Submit ALL exams allocated to the user
 *   --time <seconds>   Time spent in seconds (default: random 600-3600)
 *
 * WARNING: This script is for development/testing only.
 * Do NOT run against production databases.
 */

import { connect, disconnect } from '../connect.js';
import { UserRepository } from '../repositories/UserRepository.js';
import { ExamRepository } from '../repositories/ExamRepository.js';
import { ExamSubmissionRepository } from '../repositories/ExamSubmissionRepository.js';
import { evaluateExamResponses } from '../../dist/services/examEvaluationService.js';

const WARNING = `
╔══════════════════════════════════════════════════════════════╗
║  WARNING: TESTING SCRIPT — NOT FOR PRODUCTION USE           ║
║  This script calls the real AI evaluator (Bedrock) and      ║
║  creates submission records. Only run against dev/test DB.  ║
╚══════════════════════════════════════════════════════════════╝
`;

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Generate a plausible student answer based on the question text.
 * Gives the AI evaluator real content to grade.
 */
function generateAnswer(questionText: string, questionType: string): string {
  const lower = questionText.toLowerCase();

  if (questionType === 'MCQ' || questionType === 'TRUE_FALSE') {
    return randomInt(0, 1) === 0 ? 'Option A' : 'Option B';
  }

  if (lower.startsWith('explain') || lower.startsWith('describe') || lower.startsWith('discuss')) {
    const topic = questionText.replace(/^(Explain|Describe|Discuss)\s+/i, '').replace(/[.?]$/, '');
    return `${topic} is a fundamental concept that plays an important role in this field. ` +
      `The key aspects include understanding its core principles and how they apply to real-world scenarios. ` +
      `For example, in practical applications, we can observe that ${topic.toLowerCase()} helps solve complex problems efficiently. ` +
      `In conclusion, a thorough understanding of ${topic.toLowerCase()} is essential for mastering this subject.`;
  }

  if (lower.startsWith('compare') || lower.startsWith('contrast')) {
    return `Both concepts share some common ground in their underlying principles, particularly in how they approach problem-solving. ` +
      `However, they differ significantly in their implementation and scope. The first approach is more suited for scenarios ` +
      `where precision is critical, while the second offers greater flexibility. Each has its own strengths and trade-offs ` +
      `that should be considered based on the specific requirements of the problem at hand.`;
  }

  if (lower.startsWith('derive') || lower.startsWith('prove') || lower.startsWith('show that')) {
    return `We begin by considering the given conditions. From the first principle, we know that the fundamental relationship holds. ` +
      `Applying the relevant theorem, we can rewrite this as: f(x) = g(x) + h(x). Taking the limit as x approaches the critical value, ` +
      `we obtain the desired result. Therefore, the statement is proved. The derivation follows standard methodology and all steps are valid.`;
  }

  if (lower.startsWith('design') || lower.startsWith('write') || lower.startsWith('create')) {
    return `Here is my approach: First, I would analyze the requirements and identify the key components needed. ` +
      `Then, I would design the architecture with modularity and scalability in mind. The implementation would follow ` +
      `best practices including proper error handling, input validation, and comprehensive testing. ` +
      `For the specific requirements given, I would prioritize clarity and maintainability in the solution.`;
  }

  if (lower.startsWith('calculate') || lower.startsWith('solve') || lower.startsWith('find')) {
    return `Given the input values, we can approach this step by step. First, we identify the relevant formula: ` +
      `the standard equation applies here. Substituting the known values: we get intermediate result = 42. ` +
      `Applying the necessary transformations and simplifying, the final answer is 42. Verification: ` +
      `substituting back into the original equation confirms this result is correct.`;
  }

  if (lower.startsWith('analyze') || lower.startsWith('evaluate') || lower.startsWith('critique')) {
    return `Upon careful analysis, several key factors emerge. The primary strength of this approach is its elegant ` +
      `handling of edge cases and its scalability to larger problems. However, there are some limitations to consider: ` +
      `the computational complexity may become a bottleneck for very large inputs. Overall, the approach is sound ` +
      `and achieves its intended purpose, though optimization could be explored for production deployment.`;
  }

  // Default fallback — generic but relevant
  return `This is a well-structured answer addressing the question: "${questionText.substring(0, 80)}". ` +
    `The response covers the key concepts, provides relevant examples, and demonstrates understanding of the subject matter. ` +
    `Additional context and supporting details have been included to ensure comprehensive coverage of the topic.`;
}

async function submitExam(
  submissionRepo: ExamSubmissionRepository,
  examRepo: ExamRepository,
  userId: string,
  examId: string,
  timeSpent: number,
): Promise<{ success: boolean; submissionId?: string; error?: string }> {
  const exam = await examRepo.getWithFullDetails(examId);
  if (!exam) {
    return { success: false, error: `Exam not found: ${examId}` };
  }

  const questionDetails = exam.questionDetails || [];
  if (questionDetails.length === 0) {
    return { success: false, error: `Exam "${exam.examTitle}" has no questions` };
  }

  const maxTotalMarks = questionDetails.reduce((sum: number, qd: any) => sum + (qd.marks || 0), 0);

  // Build raw student responses (without scores yet)
  const rawResponses = questionDetails.map((qd: any) => ({
    questionId: qd._id.toString(),
    questionText: qd.promptData?.questionText || 'Question text not available',
    questionType: qd.questionType || 'TEXT',
    userResponse: generateAnswer(
      qd.promptData?.questionText || '',
      qd.questionType || 'TEXT'
    ),
    maxMarks: qd.marks || Math.floor(maxTotalMarks / questionDetails.length),
  }));

  // Call the real AI evaluator (Bedrock DeepSeek-R1)
  console.log(`  Evaluating ${rawResponses.length} question(s) via Bedrock...`);
  const evaluatedResponses = await evaluateExamResponses(rawResponses);

  // Calculate results from AI
  const totalMarks = evaluatedResponses.reduce((sum: number, r: any) => sum + (r.allottedMarks || 0), 0);
  const percentage = maxTotalMarks > 0 ? (totalMarks / maxTotalMarks) * 100 : 0;

  // Create submission (repo auto-removes from allocatedExams, adds to submissionHistory)
  const result = await submissionRepo.create({
    examId,
    userId,
    timeSpent,
    maxMarks: maxTotalMarks,
    marksAchieved: totalMarks,
    autoSubmitted: false,
    evaluatorObservations: `AI evaluation complete. Student scored ${totalMarks}/${maxTotalMarks} (${percentage.toFixed(1)}%).`,
    responses: evaluatedResponses,
  });

  if (result.success) {
    console.log(`  ✓ "${exam.examTitle}" → ${totalMarks}/${maxTotalMarks} (${percentage.toFixed(1)}%)`);
  } else if (result.submissionId) {
    console.log(`  ∼ "${exam.examTitle}" already submitted (ID: ${result.submissionId})`);
  } else {
    console.error(`  ✗ "${exam.examTitle}" failed: ${result.error}`);
  }

  return result;
}

async function main() {
  const args = process.argv.slice(2);

  console.log(WARNING);

  let userId = '';
  let email = '';
  let examId = '';
  let submitFirst = false;
  let submitAll = false;
  let timeSpent = randomInt(600, 3600);

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--email' && i + 1 < args.length) email = args[++i]!;
    else if (args[i] === '--exam-id' && i + 1 < args.length) examId = args[++i]!;
    else if (args[i] === '--first') submitFirst = true;
    else if (args[i] === '--all') submitAll = true;
    else if (args[i] === '--time' && i + 1 < args.length) timeSpent = clamp(parseInt(args[++i]!, 10), 60, 86400);
    else if (!args[i]!.startsWith('--')) {
      if (!userId) userId = args[i]!;
      else if (!examId) examId = args[i]!;
    }
  }

  const conn = await connect();
  if (conn.successCode === -1) {
    console.error('Failed to connect to database');
    process.exit(1);
  }

  const userRepo = new UserRepository();
  const examRepo = new ExamRepository();
  const submissionRepo = new ExamSubmissionRepository();

  if (email) {
    const user = await userRepo.getByEmail(email);
    if (!user) {
      console.error(`User not found: ${email}`);
      await disconnect();
      process.exit(1);
    }
    userId = user._id!;
    console.log(`User: ${user.name || email} (${userId})`);
  } else if (!userId) {
    console.error('Provide a userId or --email flag');
    console.log('Usage: npx tsx src/database/scripts/maintenance-mock-evaluate.ts <userId> <examId>');
    console.log('   or: npx tsx src/database/scripts/maintenance-mock-evaluate.ts --email user@test.edu --first');
    await disconnect();
    process.exit(1);
  } else {
    const user = await userRepo.getById(userId);
    if (!user) {
      console.error(`User not found: ${userId}`);
      await disconnect();
      process.exit(1);
    }
    console.log(`User: ${user.name || userId} (${userId})`);
  }

  console.log(`Time spent: ${timeSpent}s (${Math.round(timeSpent / 60)}min)\n`);

  const examIdsToSubmit: string[] = [];

  if (submitAll || submitFirst) {
    const user = await userRepo.getById(userId);
    if (!user || !user.currentAllocatedExams?.length) {
      console.error('User has no allocated exams');
      await disconnect();
      process.exit(1);
    }
    const allocated = user.currentAllocatedExams;
    console.log(`User has ${allocated.length} allocated exam(s)`);

    if (submitAll) {
      examIdsToSubmit.push(...allocated);
    } else {
      examIdsToSubmit.push(allocated[0]!);
    }
  } else if (examId) {
    examIdsToSubmit.push(examId);
  } else {
    console.error('Provide --exam-id, --first, or --all');
    await disconnect();
    process.exit(1);
  }

  console.log(`Submitting ${examIdsToSubmit.length} exam(s)...\n`);

  let successCount = 0;
  for (const eid of examIdsToSubmit) {
    const result = await submitExam(submissionRepo, examRepo, userId, eid, timeSpent);
    if (result.success || result.submissionId) successCount++;
  }

  // Show updated user state
  const updatedUser = await userRepo.getById(userId);
  console.log('');
  console.log('─── Updated User State ───');
  console.log(`  Allocated exams:  ${updatedUser?.currentAllocatedExams?.length || 0}`);
  console.log(`  Submissions:      ${updatedUser?.submissionHistory?.length || 0}`);
  console.log(`  Successful:       ${successCount}/${examIdsToSubmit.length}`);

  await disconnect();
  console.log('\nDone.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
