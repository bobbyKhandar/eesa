/**
 * MAINTENANCE SCRIPT — TESTING ONLY, NOT FOR PRODUCTION USE
 *
 * Simulates a student submitting an exam. Uses real AI for both
 * answer generation (Gemini) and grading (Bedrock DeepSeek-R1).
 *
 * Flow:
 *   1. Fetches the exam with question + prompt details
 *   2. Sends ALL questions + target score to Gemini in one prompt
 *   3. Gemini generates plausible student answers at the target quality
 *   4. Answers sent to evaluateExamResponses() for AI grading
 *   5. Creates a submission record with AI-evaluated scores
 *   6. Auto-moves the exam from currentAllocatedExams → submissionHistory
 *
 * Usage:
 *   npx tsx src/database/scripts/maintenance-mock-evaluate.ts --email bobby.k@somaiya.edu --first
 *   npx tsx src/database/scripts/maintenance-mock-evaluate.ts --email bobby.k@somaiya.edu --all --score=75
 *   npx tsx src/database/scripts/maintenance-mock-evaluate.ts <userId> <examId> --score=60
 *
 * Flags:
 *   --email <email>    Look up user by email instead of userId
 *   --exam-id <id>     ID of the exam to submit
 *   --first            Submit the first exam allocated to the user
 *   --all              Submit ALL exams allocated to the user
 *   --score <0-100>    Target score % — AI aims for this when generating answers (default: random 40-90)
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
import { GoogleGenerativeAI } from '@google/generative-ai';

const WARNING = `
╔══════════════════════════════════════════════════════════════╗
║  WARNING: TESTING SCRIPT — NOT FOR PRODUCTION USE           ║
║  This script calls Gemini (answer gen) and Bedrock (grade)  ║
║  and creates real submission records. Dev/test DB only.     ║
╚══════════════════════════════════════════════════════════════╝
`;

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

async function generateAnswersWithGemini(
  questionDetails: any[],
  targetScorePct: number,
): Promise<Map<string, string>> {
  const genAI = new GoogleGenerativeAI(process.env.gemini_api_key || '');
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const totalMaxMarks = questionDetails.reduce((sum: number, qd: any) => sum + (qd.marks || 0), 0);

  const questionsBlock = questionDetails.map((qd: any, i: number) => {
    const promptText = qd.promptData?.questionText || 'Question text not available';
    return `[Question ${i + 1}]
ID: ${qd._id.toString()}
Type: ${qd.questionType || 'TEXT'}
Max Marks: ${qd.marks || 5}
Text: ${promptText}
${qd.questionType === 'MCQ' && qd.options ? `Options: ${qd.options.map((o: any) => o.text).join(' | ')}` : ''}`;
  }).join('\n\n');

  const prompt = `You are a ${targetScorePct >= 70 ? 'strong' : targetScorePct >= 45 ? 'average' : 'weak'} student taking an exam. Generate realistic student answers for ALL of the following questions.

IMPORTANT: Your answers should be such that a fair evaluator would give approximately ${targetScorePct}% of the total marks (${totalMaxMarks} × ${targetScorePct}% ≈ ${Math.round(totalMaxMarks * targetScorePct / 100)} marks).

Guidelines:
- For MCQ/TRUE_FALSE: just pick one option text.
- For theory questions (Short/Long/TEXT): write natural, paragraph-style answers with appropriate depth for the marks.
- A ${targetScorePct}% student ${targetScorePct >= 80 ? 'gives thorough, well-structured answers with examples and clear reasoning.' : targetScorePct >= 60 ? 'gives mostly correct answers but may miss some depth or nuance.' : targetScorePct >= 40 ? 'gives partially correct answers with some key points missing.' : 'gives incomplete or superficial answers.'}
- Be realistic — include minor mistakes, omissions, or unclear explanations appropriate for this score level.
- Do NOT write perfect answers.

Here are the questions:

${questionsBlock}

Respond with ONLY a JSON array. No markdown, no other text:
[
  {
    "questionId": "...",
    "answer": "the student's answer text here"
  },
  ...
]`;

  console.log('  Generating answers via Gemini...');
  const result = await model.generateContent(prompt);
  const text = result.response.text().replace(/^```json\s*|\s*```$/g, '').trim();
  const parsed = JSON.parse(text);

  const answerMap = new Map<string, string>();
  for (const item of parsed) {
    answerMap.set(item.questionId, item.answer);
  }
  return answerMap;
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
    return { success: false, error: `Exam "${exam.examTitle}" has no questions` };
  }

  const maxTotalMarks = questionDetails.reduce((sum: number, qd: any) => sum + (qd.marks || 0), 0);

  // Step 1: Generate answers via Gemini (all questions, one prompt)
  const answerMap = await generateAnswersWithGemini(questionDetails, targetScorePct);

  // Step 2: Build raw responses for the evaluator
  const rawResponses = questionDetails.map((qd: any) => ({
    questionId: qd._id.toString(),
    questionText: qd.promptData?.questionText || 'Question text not available',
    questionType: qd.questionType || 'TEXT',
    userResponse: answerMap.get(qd._id.toString()) || '[Answer not generated]',
    maxMarks: qd.marks || Math.floor(maxTotalMarks / questionDetails.length),
  }));

  // Step 3: Call the real AI evaluator (Bedrock DeepSeek-R1)
  console.log(`  Evaluating ${rawResponses.length} question(s) via Bedrock...`);
  const evaluatedResponses = await evaluateExamResponses(rawResponses);

  // Step 4: Calculate results
  const totalMarks = evaluatedResponses.reduce((sum: number, r: any) => sum + (r.allottedMarks || 0), 0);
  const percentage = maxTotalMarks > 0 ? (totalMarks / maxTotalMarks) * 100 : 0;

  // Step 5: Create submission
  const result = await submissionRepo.create({
    examId,
    userId,
    timeSpent,
    maxMarks: maxTotalMarks,
    marksAchieved: totalMarks,
    autoSubmitted: false,
    evaluatorObservations: `Target: ${targetScorePct}%. Achieved: ${totalMarks}/${maxTotalMarks} (${percentage.toFixed(1)}%).`,
    responses: evaluatedResponses,
  });

  if (result.success) {
    console.log(`  ✓ "${exam.examTitle}" → ${totalMarks}/${maxTotalMarks} (${percentage.toFixed(1)}%) [target: ${targetScorePct}%]`);
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

  if (!process.env.gemini_api_key) {
    console.error('Missing gemini_api_key in environment');
    process.exit(1);
  }

  let userId = '';
  let email = '';
  let examId = '';
  let submitFirst = false;
  let submitAll = false;
  let targetScorePct = randomInt(40, 90);
  let timeSpent = randomInt(600, 3600);

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--email' && i + 1 < args.length) email = args[++i]!;
    else if (args[i] === '--exam-id' && i + 1 < args.length) examId = args[++i]!;
    else if (args[i] === '--first') submitFirst = true;
    else if (args[i] === '--all') submitAll = true;
    else if (args[i] === '--score' && i + 1 < args.length) targetScorePct = clamp(parseInt(args[++i]!, 10), 0, 100);
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

  console.log(`Target score: ${targetScorePct}%`);
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
    console.error('Provide --exam-id, --first, or --all');
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
