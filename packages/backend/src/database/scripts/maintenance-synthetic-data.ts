/**
 * MAINTENANCE SCRIPT — TESTING ONLY, NOT FOR PRODUCTION USE
 *
 * Generates comprehensive synthetic data across all collections:
 * users, prompts, exam questions, exams, and submissions.
 *
 * Usage:
 *   npx tsx src/database/scripts/maintenance-synthetic-data.ts [--count=N]
 *
 * Options:
 *   --count=N  Items per collection (default: 10)
 *
 * Examples:
 *   npx tsx src/database/scripts/maintenance-synthetic-data.ts
 *   npx tsx src/database/scripts/maintenance-synthetic-data.ts --count=5
 *
 * WARNING: This script is for development/testing only.
 * Do NOT run against production databases.
 */

import { connect, disconnect } from '../connect.js';
import { UserRepository } from '../repositories/UserRepository.js';
import { PromptRepository } from '../repositories/PromptRepository.js';
import { ExamRepository } from '../repositories/ExamRepository.js';
import { ExamSubmissionRepository } from '../repositories/ExamSubmissionRepository.js';

const WARNING = `
╔══════════════════════════════════════════════════════════════╗
║  WARNING: TESTING SCRIPT — NOT FOR PRODUCTION USE           ║
║  This script creates synthetic data and should only be run  ║
║  against development/test databases.                        ║
╚══════════════════════════════════════════════════════════════╝
`;

// ── Configuration ──────────────────────────────────────────────────────────

const SUBJECTS = [
  { name: 'Mathematics', code: 'MTH101', degree: 'B.Sc.' },
  { name: 'Physics', code: 'PHY101', degree: 'B.Sc.' },
  { name: 'Computer Science', code: 'CSC101', degree: 'B.E.' },
  { name: 'Electronics', code: 'ELC201', degree: 'B.E.' },
  { name: 'English Literature', code: 'ENG101', degree: 'B.A.' },
];

const EXAM_TYPES = ['Midterm', 'Final', 'Quiz', 'Practice Test'];

const BLOOMS_LEVELS = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'] as const;

const STUDENT_NAMES = [
  'Alice Johnson', 'Bob Smith', 'Charlie Brown', 'Diana Prince', 'Edward Norton',
  'Fiona Apple', 'George Lucas', 'Hannah Montana', 'Ivan Petrov', 'Julia Roberts',
  'Kevin Hart', 'Laura Croft', 'Mike Tyson', 'Nancy Drew', 'Oscar Wilde',
  'Paula Abdul', 'Quinn Fabray', 'Rachel Green', 'Steve Jobs', 'Tina Fey',
];

const QUESTIONS = [
  { text: 'Explain the fundamental theorem of calculus and provide an example.', topic: 'Calculus', bloomsLevel: 'understand' as const },
  { text: 'Derive the quadratic formula using completing the square method.', topic: 'Algebra', bloomsLevel: 'apply' as const },
  { text: 'Compare and contrast Newtonian and Lagrangian mechanics.', topic: 'Mechanics', bloomsLevel: 'analyze' as const },
  { text: 'Write a recursive function to compute Fibonacci numbers.', topic: 'Programming', bloomsLevel: 'apply' as const },
  { text: 'Analyze the time complexity of quicksort in best and worst cases.', topic: 'Algorithms', bloomsLevel: 'analyze' as const },
  { text: 'Design a database schema for a library management system.', topic: 'Databases', bloomsLevel: 'create' as const },
  { text: 'Evaluate the efficiency of different sorting algorithms for large datasets.', topic: 'Algorithms', bloomsLevel: 'evaluate' as const },
  { text: 'State and prove the divergence theorem in vector calculus.', topic: 'Calculus', bloomsLevel: 'remember' as const },
  { text: 'Describe the working principle of a MOSFET transistor.', topic: 'Electronics', bloomsLevel: 'understand' as const },
  { text: 'Explain the concept of polymorphism in object-oriented programming.', topic: 'Programming', bloomsLevel: 'understand' as const },
  { text: 'Solve the differential equation dy/dx + y = e^x.', topic: 'Calculus', bloomsLevel: 'apply' as const },
  { text: 'Discuss the historical context and literary devices used in Shakespearian sonnets.', topic: 'Literature', bloomsLevel: 'analyze' as const },
  { text: 'Design a RESTful API for an e-commerce platform.', topic: 'Web Development', bloomsLevel: 'create' as const },
  { text: 'Calculate the electric field due to a uniformly charged infinite sheet.', topic: 'Electromagnetism', bloomsLevel: 'apply' as const },
  { text: 'Critique the proof of Fermats last theorem and its implications.', topic: 'Number Theory', bloomsLevel: 'evaluate' as const },
  { text: 'Explain the concept of encapsulation with a real-world example.', topic: 'Programming', bloomsLevel: 'understand' as const },
  { text: 'Solve the system of linear equations using Gaussian elimination.', topic: 'Algebra', bloomsLevel: 'apply' as const },
  { text: 'Analyze the impact of distributed systems on modern cloud computing.', topic: 'Systems', bloomsLevel: 'analyze' as const },
  { text: 'Write a SQL query to find the second highest salary from an employee table.', topic: 'Databases', bloomsLevel: 'create' as const },
  { text: 'Describe the process of mitosis and its phases.', topic: 'Biology', bloomsLevel: 'remember' as const },
  { text: 'Compare the time complexity of BFS and DFS graph traversal algorithms.', topic: 'Algorithms', bloomsLevel: 'analyze' as const },
  { text: 'Design a fault-tolerant system for a banking application.', topic: 'Systems', bloomsLevel: 'create' as const },
  { text: 'Explain the concept of normalization in database design.', topic: 'Databases', bloomsLevel: 'understand' as const },
  { text: 'Calculate the probability of getting a sum of 7 when rolling two dice.', topic: 'Probability', bloomsLevel: 'apply' as const },
  { text: 'Evaluate the effectiveness of different machine learning algorithms for text classification.', topic: 'AI', bloomsLevel: 'evaluate' as const },
];

// ── Helper ─────────────────────────────────────────────────────────────────

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomBoolean(probability = 0.5): boolean {
  return Math.random() < probability;
}

function pickN<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(n, arr.length));
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const countArg = args.find(a => a.startsWith('--count='));
  const count = countArg ? parseInt(countArg.split('=')[1], 10) : 10;

  console.log(WARNING);
  console.log(`Count per collection: ${count}\n`);

  const conn = await connect();
  if (conn.successCode === -1) {
    console.error('Failed to connect to database');
    process.exit(1);
  }

  const userRepo = new UserRepository();
  const promptRepo = new PromptRepository();
  const examRepo = new ExamRepository();
  const submissionRepo = new ExamSubmissionRepository();

  // ── 1. Users ──────────────────────────────────────────────────────────

  const userIds: string[] = [];
  const teacherIds: string[] = [];
  let adminId = '';

  console.log('─── Generating Users ───');

  // Note: userZodSchema defines _id as z.string().optional() — Mongoose
  // won't auto-generate one. Provide explicit _id values here.
  const runId = Date.now();
  let idCounter = 0;
  const nextId = () => `synth_${runId}_${++idCounter}`;

  // Admin (first)
  const adminResult = await userRepo.create({
    _id: nextId(),
    email: `admin.${runId}@test.edu`,
    name: 'System Admin',
    role: 'admin',
    currentAllocatedExams: [],
    submissionHistory: [],
    createdAt: new Date(),
  });
  if (adminResult.success && adminResult.userId) {
    adminId = adminResult.userId;
    console.log(`  ✓ Admin: admin@test.edu -> ${adminId}`);
  }

  // Teachers
  const teacherNames = ['Dr. Sarah Connor', 'Prof. Alan Turing', 'Dr. Grace Hopper', 'Prof. Richard Feynman', 'Dr. Ada Lovelace'];
  for (let i = 0; i < Math.min(3, count); i++) {
    const name = teacherNames[i]!;
    const result = await userRepo.create({
      _id: nextId(),
      email: `teacher${i + 1}.${runId}@test.edu`,
      name,
      role: 'teacher',
      currentAllocatedExams: [],
      submissionHistory: [],
      createdAt: new Date(),
    });
    if (result.success && result.userId) {
      teacherIds.push(result.userId);
      console.log(`  ✓ Teacher: ${name} -> ${result.userId}`);
    }
  }

  // Students
  for (let i = 0; i < count; i++) {
    const name = STUDENT_NAMES[i % STUDENT_NAMES.length]!;
    const result = await userRepo.create({
      _id: nextId(),
      email: `student${i + 1}.${runId}@test.edu`,
      name,
      role: 'student',
      currentAllocatedExams: [],
      submissionHistory: [],
      createdAt: new Date(),
    });
    if (result.success && result.userId) {
      userIds.push(result.userId);
    }
  }
  console.log(`  ✓ ${userIds.length} students created`);

  const allUserIds = [...teacherIds, ...userIds];
  if (allUserIds.length === 0) {
    console.error('No users created — aborting');
    await disconnect();
    process.exit(1);
  }

  // ── 2. Prompts ────────────────────────────────────────────────────────

  console.log('\n─── Generating Prompts ───');
  const promptIds: string[] = [];

  for (let i = 0; i < count * 3; i++) {
    const q = QUESTIONS[i % QUESTIONS.length]!;
    const subject = SUBJECTS[i % SUBJECTS.length]!;
    const blooms = q.bloomsLevel || randomItem([...BLOOMS_LEVELS]);
    const result = await promptRepo.create({
      questionText: q.text,
      subject: subject.name,
      subjectCode: subject.code,
      topic: q.topic,
      branch: subject.name === 'Computer Science' ? 'Computer Engineering' : subject.name,
      questionType: randomItem(['text', 'mcq', 'Short', 'Long'] as const),
      marks: String(randomInt(5, 20)),
      bloomLevel: randomItem(['Recall', 'Understand', 'Apply', 'Analyze', 'Evaluate', 'Create']),
      bloomsLevel: blooms,
      difficulty: randomItem(['Easy', 'Medium', 'Hard']),
      keywords: [q.topic, subject.name, blooms],
      topicsCovered: [q.topic],
      generateVia: randomItem(['llm', 'bedrock'] as const),
      createdBy: randomItem(teacherIds.length ? teacherIds : [adminId || 'system']),
      confidence: parseFloat((0.7 + Math.random() * 0.3).toFixed(2)),
    });
    if (result.success && result.promptId) {
      promptIds.push(result.promptId);
    }
  }
  console.log(`  ✓ ${promptIds.length} prompts created`);

  if (promptIds.length === 0) {
    console.error('No prompts created — aborting');
    await disconnect();
    process.exit(1);
  }

  // ── 3. Exams ──────────────────────────────────────────────────────────

  console.log('\n─── Generating Exams ───');

  for (let i = 0; i < count; i++) {
    const subject = SUBJECTS[i % SUBJECTS.length]!;
    const questionsPerExam = randomInt(3, 6);
    const selectedPrompts = pickN(promptIds, questionsPerExam);
    const assignedUsers = pickN(allUserIds, randomInt(3, Math.min(8, allUserIds.length)));

    // Build question data for createWithPrompts
    const examQuestions = selectedPrompts.map(promptId => {
      const qType = randomItem(['MCQ', 'TEXT', 'TRUE_FALSE'] as const);
      const marks = randomInt(5, 20);
      const hasOptions = qType === 'MCQ' || qType === 'TRUE_FALSE';
      return {
        promptId,
        marks,
        questionType: qType,
        answer: qType === 'MCQ' ? String(randomInt(0, 3)) : 'Sample answer text for evaluation',
        options: hasOptions
          ? [
              { text: 'Option A', isCorrect: qType === 'TRUE_FALSE' ? randomBoolean() : false },
              { text: 'Option B', isCorrect: qType === 'TRUE_FALSE' ? randomBoolean() : false },
              ...(qType === 'MCQ'
                ? [
                    { text: 'Option C', isCorrect: false },
                    { text: 'Option D', isCorrect: false },
                  ]
                : []),
            ]
          : undefined,
      };
    });

    const result = await examRepo.createWithPrompts({
      examTitle: `${subject.name} ${randomItem(EXAM_TYPES)} ${i + 1}`,
      examDescription: `${subject.name} ${randomItem(EXAM_TYPES)} covering ${subject.code} syllabus`,
      subject: subject.name,
      examDegree: subject.degree,
      examType: randomItem(EXAM_TYPES),
      passingPercentage: randomInt(30, 50),
      duration: randomInt(60, 180),
      createdBy: randomItem(teacherIds.length ? teacherIds : [adminId || 'system']),
      assignedUsers,
      questions: examQuestions,
      instructions: 'Answer all questions. Duration and marks are indicated.',
      negativeMarking: randomBoolean(0.2),
      negativeMarkingPercentage: randomBoolean(0.2) ? randomInt(10, 50) : undefined,
    });

    if (result.success && result.examId) {
      console.log(`  ✓ Exam ${i + 1}/${count}: ${subject.name} ${randomItem(EXAM_TYPES)} -> ${result.examId}`);
    } else {
      console.error(`  ✗ Exam ${i + 1} failed: ${result.error}`);
    }
  }

  // ── 4. Submissions ────────────────────────────────────────────────────

  console.log('\n─── Generating Submissions ───');

  // Fetch all exams (they were just created)
  const allExams = await examRepo.getAll(50);
  if (allExams.length === 0) {
    console.log('  No exams found — skipping submissions');
  } else {
    const studentIds = [...userIds]; // Only students get submissions
    let subCount = 0;

    for (const exam of allExams) {
      if (studentIds.length === 0) break;

      // Submit for ~60% of assigned students
      const assignedStudents = exam.assignedUsers?.filter(id => studentIds.includes(id)) || [];
      if (assignedStudents.length === 0) continue;

      const submittingStudents = pickN(assignedStudents, Math.ceil(assignedStudents.length * 0.6));

      for (const studentId of submittingStudents) {
        const totalMarks = exam.examMaxMarks || 100;
        const marksAchieved = randomInt(Math.floor(totalMarks * 0.2), Math.floor(totalMarks * 0.95));
        const questionCount = exam.questions?.length || 1;
        const marksPerQ = Math.floor(totalMarks / questionCount);

        const responses = (exam.questions || []).map((qId: string) => {
          const allottedMarks = randomInt(0, marksPerQ);
          return {
            questionId: qId,
            userResponse: 'This is a sample student response for testing purposes.',
            maxMarks: marksPerQ,
            allottedMarks,
            feedback: allottedMarks >= marksPerQ * 0.7
              ? 'Good understanding shown. Well-structured answer.'
              : allottedMarks >= marksPerQ * 0.4
                ? 'Partially correct. Some key points missing.'
                : 'Insufficient answer. Needs improvement.',
            suggestions: allottedMarks < marksPerQ * 0.7
              ? ['Review the core concepts', 'Practice similar problems', 'Refer to textbook chapters']
              : [],
          };
        });

        const result = await submissionRepo.create({
          examId: exam._id!,
          userId: studentId,
          timeSpent: randomInt(600, 7200),
          maxMarks: totalMarks,
          marksAchieved,
          autoSubmitted: randomBoolean(0.1),
          evaluatorObservations: marksAchieved >= totalMarks * 0.7
            ? 'Student demonstrates good command of the subject.'
            : marksAchieved >= totalMarks * 0.4
              ? 'Student shows moderate understanding but needs improvement in certain areas.'
              : 'Student requires significant improvement and additional study.',
          responses,
        });

        if (result.success || result.submissionId) {
          subCount++;
        }
      }
    }
    console.log(`  ✓ ${subCount} submissions created`);
  }

  // ── Summary ───────────────────────────────────────────────────────────

  console.log('\n─── Summary ───');
  console.log(`  Users:       ${allUserIds.length + (adminId ? 1 : 0)} (${userIds.length} students, ${teacherIds.length} teachers, ${adminId ? 1 : 0} admin)`);
  console.log(`  Prompts:     ${promptIds.length}`);
  console.log(`  Exams:       ${allExams.length}`);
  console.log('');

  await disconnect();
  console.log('Done.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
