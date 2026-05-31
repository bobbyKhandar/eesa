/**
 * MAINTENANCE SCRIPT — TESTING ONLY, NOT FOR PRODUCTION USE
 *
 * Simulates a student submitting an exam and the system evaluating it.
 *
 * Flow:
 *   1. Fetches the exam with questions and prompt details
 *   2. Generates mock evaluations per question (allotted marks, feedback)
 *   3. Creates a submission record
 *   4. Auto-moves the exam from currentAllocatedExams → submissionHistory
 *
 * Usage:
 *   npx tsx src/database/scripts/maintenance-mock-evaluate.ts <userId> <examId>
 *
 * Examples:
 *   npx tsx src/database/scripts/maintenance-mock-evaluate.ts student1_uid exam1_uid
 *   npx tsx src/database/scripts/maintenance-mock-evaluate.ts --email bobby.k@somaiya.edu --exam-id <id>
 *   npx tsx src/database/scripts/maintenance-mock-evaluate.ts --email bobby.k@somaiya.edu --first
 *
 * Flags:
 *   --email <email>    Look up user by email instead of userId
 *   --exam-id <id>     ID of the exam to submit
 *   --first            Submit the first exam allocated to the user
 *   --all              Submit ALL exams allocated to the user
 *   --score <0-100>    Target score percentage (default: random 40-90)
 *   --time <seconds>   Time spent in seconds (default: random 600-3600)
 *
 * WARNING: This script is for development/testing only.
 * Do NOT run against production databases.
 */

import { connect, disconnect } from '../connect.js';
import { UserRepository } from '../repositories/UserRepository.js';
import { ExamRepository } from '../repositories/ExamRepository.js';
import { ExamSubmissionRepository } from '../repositories/ExamSubmissionRepository.js';

const WARNING = `
╔══════════════════════════════════════════════════════════════╗
║  WARNING: TESTING SCRIPT — NOT FOR PRODUCTION USE           ║
║  This script creates dummy submissions and should only be   ║
║  run against development/test databases.                    ║
╚══════════════════════════════════════════════════════════════╝
`;

const FEEDBACK_TEMPLATES = [
  {
    minScore: 0.8,
    feedback: 'Excellent answer. Demonstrates comprehensive understanding of the topic.',
    suggestions: [] as string[],
  },
  {
    minScore: 0.6,
    feedback: 'Good answer with solid understanding. Minor details could be improved.',
    suggestions: ['Review edge cases and special scenarios'],
  },
  {
    minScore: 0.4,
    feedback: 'Partially correct answer. Several key concepts are missing.',
    suggestions: ['Study the core concepts again', 'Practice with similar problems'],
  },
  {
    minScore: 0.2,
    feedback: 'Insufficient answer. Does not adequately address the question.',
    suggestions: ['Revisit the fundamental concepts', 'Seek additional learning resources', 'Practice regularly'],
  },
  {
    minScore: 0,
    feedback: 'Incorrect or irrelevant response.',
    suggestions: ['Start from basics', 'Consult reference materials', 'Attend review sessions'],
  },
];

function getFeedback(scoreRatio: number): { feedback: string; suggestions: string[] } {
  for (const tpl of FEEDBACK_TEMPLATES) {
    if (scoreRatio >= tpl.minScore) return { feedback: tpl.feedback, suggestions: [...tpl.suggestions] };
  }
  return FEEDBACK_TEMPLATES[FEEDBACK_TEMPLATES.length - 1]!;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

async function submitExam(
  submissionRepo: ExamSubmissionRepository,
  examRepo: ExamRepository,
  userId: string,
  examId: string,
  targetScorePct: number,
  timeSpent: number,
): Promise<{ success: boolean; submissionId?: string; error?: string }> {
  const exam = await examRepo.getWithFullDetails(examId);
  if (!exam) {
    return { success: false, error: `Exam not found: ${examId}` };
  }

  const questionDetails = exam.questionDetails || [];
  if (questionDetails.length === 0) {
    return { success: false, error: `Exam ${exam.examTitle} has no questions` };
  }

  const totalMarks = exam.examMaxMarks || questionDetails.reduce((sum: number, qd: any) => sum + (qd.marks || 0), 0);
  const marksPerQ = questionDetails.map((qd: any) => qd.marks || Math.floor(totalMarks / questionDetails.length));

  let targetAchieved = Math.round(totalMarks * (targetScorePct / 100));
  targetAchieved = clamp(targetAchieved, 0, totalMarks);

  // Distribute marks across questions proportionally
  let remainingTarget = targetAchieved;
  const responses = questionDetails.map((qd: any, idx: number) => {
    const maxQ = marksPerQ[idx]!;
    const isLast = idx === questionDetails.length - 1;
    const allottedMarks = isLast
      ? clamp(remainingTarget, 0, maxQ)
      : clamp(Math.round(remainingTarget * (maxQ / totalMarks)), 0, maxQ);
    remainingTarget -= allottedMarks;

    const ratio = maxQ > 0 ? allottedMarks / maxQ : 0;
    const { feedback, suggestions } = getFeedback(ratio);

    const promptText = qd.promptData?.questionText || 'Answer text not available';

    return {
      questionId: qd._id.toString(),
      userResponse: `This is my answer to: "${promptText.substring(0, 60)}..."`,
      maxMarks: maxQ,
      allottedMarks,
      feedback,
      suggestions,
    };
  });

  const actualAchieved = responses.reduce((sum: number, r: any) => sum + r.allottedMarks, 0);

  const evaluatorObs =
    actualAchieved >= totalMarks * 0.8
      ? 'Excellent performance. Student has mastered the material.'
      : actualAchieved >= totalMarks * 0.6
        ? 'Good performance. Student demonstrates solid understanding with room for improvement.'
        : actualAchieved >= totalMarks * 0.4
          ? 'Average performance. Key areas need strengthening.'
          : 'Below average performance. Significant improvement needed.';

  const result = await submissionRepo.create({
    examId,
    userId,
    timeSpent,
    maxMarks: totalMarks,
    marksAchieved: actualAchieved,
    autoSubmitted: false,
    evaluatorObservations: evaluatorObs,
    responses,
  });

  if (result.success) {
    console.log(`  ✓ "${exam.examTitle}" → ${actualAchieved}/${totalMarks} (${Math.round((actualAchieved / totalMarks) * 100)}%)`);
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
  let targetScorePct = randomInt(40, 90);
  let timeSpent = randomInt(600, 3600);

  // Parse flags
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--email' && i + 1 < args.length) email = args[++i]!;
    else if (args[i] === '--exam-id' && i + 1 < args.length) examId = args[++i]!;
    else if (args[i] === '--first') submitFirst = true;
    else if (args[i] === '--all') submitAll = true;
    else if (args[i] === '--score' && i + 1 < args.length) targetScorePct = clamp(parseInt(args[++i]!, 10), 0, 100);
    else if (args[i] === '--time' && i + 1 < args.length) timeSpent = clamp(parseInt(args[++i]!, 10), 60, 86400);
    else if (!args[i]!.startsWith('--')) {
      // Positional: first is userId, second is examId
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

  // Resolve user
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

  console.log(`Score target: ${targetScorePct}%`);
  console.log(`Time spent:   ${timeSpent}s (${Math.round(timeSpent / 60)}min)`);
  console.log('');

  // Resolve exam(s)
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
    console.error('Provide an --exam-id, --first, or --all flag');
    await disconnect();
    process.exit(1);
  }

  console.log(`Submitting ${examIdsToSubmit.length} exam(s)...\n`);

  let successCount = 0;
  for (const eid of examIdsToSubmit) {
    const result = await submitExam(submissionRepo, examRepo, userId, eid, targetScorePct, timeSpent);
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
