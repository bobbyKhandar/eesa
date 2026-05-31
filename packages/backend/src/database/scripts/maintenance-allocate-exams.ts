/**
 * MAINTENANCE SCRIPT — TESTING ONLY, NOT FOR PRODUCTION USE
 *
 * Allocates first N exams to a given user and creates dummy submissions
 * so the user can test dashboard views (allocated exams + submission history).
 *
 * Usage:
 *   npx tsx src/database/scripts/maintenance-allocate-exams.ts <email> [count]
 *
 * Examples:
 *   npx tsx src/database/scripts/maintenance-allocate-exams.ts bobby.k@somaiya.edu
 *   npx tsx src/database/scripts/maintenance-allocate-exams.ts bobby.k@somaiya.edu 3
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
║  This script creates dummy data and should only be run      ║
║  against development/test databases.                        ║
╚══════════════════════════════════════════════════════════════╝
`;

console.log(WARNING);

const email = process.argv[2];
const count = parseInt(process.argv[3] || '5', 10);

if (!email) {
  console.error('Usage: npx tsx src/database/scripts/maintenance-allocate-exams.ts <email> [count]');
  process.exit(1);
}

console.log(`Target user: ${email}`);
console.log(`Exams to process: ${count}\n`);

// The submissions repo auto-removes from currentAllocatedExams.
// To leave some exams in the allocated state (for testing the
// take-exam flow), we allocate 2x the count but only submit half.

async function main() {
  const userRepo = new UserRepository();
  const examRepo = new ExamRepository();
  const submissionRepo = new ExamSubmissionRepository();

  const conn = await connect();
  if (conn.successCode === -1) {
    console.error('Failed to connect to database');
    process.exit(1);
  }

  // 1. Find user by email
  const user = await userRepo.getByEmail(email);
  if (!user) {
    console.error(`User not found: ${email}`);
    await disconnect();
    process.exit(1);
  }
  const userId = user._id!;
  console.log(`Found user: ${user.name || email} (${userId})`);

  // 2. Fetch first (count * 2) exams (half for submission, half for allocation)
  const allExams = await examRepo.getAll(count * 2);
  if (allExams.length === 0) {
    console.error('No exams found in database');
    await disconnect();
    process.exit(1);
  }

  const submitExams = allExams.slice(0, Math.min(count, allExams.length));
  const allocateExams = allExams.slice(submitExams.length, submitExams.length + count);

  console.log(`\nExams found: ${allExams.length}`);
  console.log(`Will create submissions for: ${submitExams.length}`);
  console.log(`Will allocate (without submission) for: ${allocateExams.length}\n`);

  // 3. Create dummy submissions (this auto-adds to submissionHistory
  //    and removes from currentAllocatedExams)
  let submitted = 0;
  for (const exam of submitExams) {
    const existingResult = await submissionRepo.create({
      examId: exam._id!,
      userId,
      timeSpent: Math.floor(Math.random() * 3600) + 600,       // 10–70 min
      maxMarks: exam.examMaxMarks,
      marksAchieved: Math.floor(Math.random() * exam.examMaxMarks),
      autoSubmitted: false,
      responses: (exam.questions || []).map((qId: string) => ({
        questionId: qId,
        userResponse: 'Dummy response for testing',
        maxMarks: Math.floor(exam.examMaxMarks / Math.max(exam.questions?.length || 1, 1)),
        allottedMarks: Math.floor(Math.random() * 5) + 1,
      })),
    });

    if (existingResult.success) {
      submitted++;
      console.log(`  ✓ Submitted: ${exam.examTitle} -> ${existingResult.submissionId}`);
    } else if (existingResult.submissionId) {
      console.log(`  ∼ Already submitted: ${exam.examTitle}`);
      submitted++;
    } else {
      console.error(`  ✗ Failed to submit ${exam.examTitle}: ${existingResult.error}`);
    }
  }

  // 4. Allocate remaining exams (without submission)
  let allocated = 0;
  for (const exam of allocateExams) {
    const result = await userRepo.assignExam(userId, exam._id!);
    if (result.success) {
      allocated++;
      console.log(`  ✓ Allocated: ${exam.examTitle}`);
    } else {
      console.error(`  ✗ Failed to allocate ${exam.examTitle}: ${result.error}`);
    }
  }

  // 5. Summary
  console.log(`\n─── Summary ───`);
  console.log(`  User:           ${user.name || email} (${userId})`);
  console.log(`  Submissions:    ${submitted}`);
  console.log(`  Allocated:      ${allocated}`);
  console.log(`  Total exams:    ${allExams.length}`);

  await disconnect();
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
