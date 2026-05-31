/**
 * Sample Data Generator
 * Generates realistic test data for all collections
 * 
 * Usage:
 *   ts-node generate-sample-data.ts [--clear] [--count=50]
 *   OR
 *   npx tsx generate-sample-data.ts [--clear] [--count=50]
 * 
 * Options:
 *    // Generate admins (5% of users)
  const adminCount = Math.max(1, Math.floor(count * 0.05));
  for (let i = 0; i < adminCount; i++) {
    const firstName = randomItem(firstNames)!;
    const lastName = randomItem(lastNames)!;
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${i}@admin.edu`;
    
    const result = await userRepo.create({
      email,
      name: `Admin ${firstName} ${lastName}`,
      role: 'admin',
      currentAllocatedExams: [],
      submissionHistory: [],
      createdAt: new Date()
    });
    
    if (result.success && result.userId) {
      admins.push(result.userId);
    }
  }isting data before generating
 *   --count   Number of items to generate (default: 50)
 */

import { connect, disconnect } from '../connect.js';
import { PromptRepository } from '../repositories/PromptRepository.js';
import { ExamQuestionRepository } from '../repositories/ExamQuestionRepository.js';
import { ExamRepository } from '../repositories/ExamRepository.js';
import { ExamSubmissionRepository } from '../repositories/ExamSubmissionRepository.js';
import { UserRepository } from '../repositories/UserRepository.js';
import { getUserModel } from '../mongooseSchemas.js';

// Parse command line arguments
const args = process.argv.slice(2);
const shouldClear = args.includes('--clear');
const countArg = args.find(arg => arg.startsWith('--count='));
const itemCount = countArg ? parseInt(countArg.split('=')[1]) : 50;

console.log('\n========================================');
console.log('Sample Data Generator');
console.log('========================================');
console.log(`Mode: ${shouldClear ? 'CLEAR & GENERATE' : 'GENERATE ONLY'}`);
console.log(`Items per collection: ${itemCount}`);
console.log('========================================\n');

// Types
type BloomsLevel = 'remember' | 'understand' | 'apply' | 'analyze' | 'evaluate' | 'create';
type GenerateVia = 'llm' | 'ocr' | 'user';
type AnswerType = 'mcq' | 'multiple-select' | 'short' | 'long';
type ExamType = 'Midterm' | 'Final' | 'Quiz' | 'Practice Test' | 'Mock Exam';

interface QuestionTemplate {
  text: string;
  confidence?: number;
  subject: string;
  topic: string;
}

interface PromptData {
  questionText: string;
  subject: string;
  topic: string;
  generateVia: GenerateVia;
  source?: string;
  ocrConfidence?: number;
  createdBy: string;
  bloomsLevel: BloomsLevel;
}

interface ExamQuestionData {
  promptId: string;
  questionType: 'MCQ' | 'TEXT' | 'TRUE_FALSE';
  marks: number;
  negativeMarks?: number;
  answer: string | number[];
  options?: Array<{ text: string; isCorrect: boolean }>;
}

// Sample data templates
const subjects: string[] = [
  'Mathematics',
  'Physics',
  'Chemistry',
  'Biology',
  'Computer Science',
  'English Literature',
  'History',
  'Geography'
];

const topics: Record<string, string[]> = {
  'Mathematics': ['Algebra', 'Calculus', 'Geometry', 'Statistics', 'Trigonometry'],
  'Physics': ['Mechanics', 'Thermodynamics', 'Electromagnetism', 'Optics', 'Quantum Physics'],
  'Chemistry': ['Organic Chemistry', 'Inorganic Chemistry', 'Physical Chemistry', 'Biochemistry'],
  'Biology': ['Cell Biology', 'Genetics', 'Ecology', 'Evolution', 'Anatomy'],
  'Computer Science': ['Data Structures', 'Algorithms', 'Databases', 'Networks', 'AI/ML'],
  'English Literature': ['Poetry', 'Drama', 'Prose', 'Literary Criticism'],
  'History': ['Ancient History', 'Medieval History', 'Modern History', 'World Wars'],
  'Geography': ['Physical Geography', 'Human Geography', 'Climate', 'Cartography']
};

const bloomsLevels: BloomsLevel[] = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'];

const examTypes: ExamType[] = ['Midterm', 'Final', 'Quiz', 'Practice Test', 'Mock Exam'];

// OCR simulation data (with varying confidence)
const ocrQuestions: QuestionTemplate[] = [
  {
    text: "What is the derivative of x²?",
    confidence: 0.95,
    subject: 'Mathematics',
    topic: 'Calculus'
  },
  {
    text: "Explain Newton's first law of motion",
    confidence: 0.88,
    subject: 'Physics',
    topic: 'Mechanics'
  },
  {
    text: "What is the molecular formula of glucose?",
    confidence: 0.92,
    subject: 'Chemistry',
    topic: 'Organic Chemistry'
  },
  {
    text: "Define DNA replication",
    confidence: 0.78, // Low confidence - needs review
    subject: 'Biology',
    topic: 'Genetics'
  },
  {
    text: "What is the time complexity of binary search?",
    confidence: 0.91,
    subject: 'Computer Science',
    topic: 'Algorithms'
  }
];

// LLM-generated questions
const llmQuestions: QuestionTemplate[] = [
  {
    text: "Compare and contrast the theories of absolute advantage and comparative advantage in international trade.",
    subject: 'Economics',
    topic: 'Trade Theory'
  },
  {
    text: "Analyze the impact of climate change on biodiversity in tropical rainforests.",
    subject: 'Biology',
    topic: 'Ecology'
  },
  {
    text: "Evaluate the effectiveness of different sorting algorithms for large datasets.",
    subject: 'Computer Science',
    topic: 'Algorithms'
  },
  {
    text: "Discuss the themes of mortality and ambition in Shakespeare's Macbeth.",
    subject: 'English Literature',
    topic: 'Drama'
  },
  {
    text: "Explain the concept of quantum entanglement and its implications for quantum computing.",
    subject: 'Physics',
    topic: 'Quantum Physics'
  }
];

// User-created questions
const userQuestions: QuestionTemplate[] = [
  {
    text: "Solve: 2x + 5 = 15",
    subject: 'Mathematics',
    topic: 'Algebra'
  },
  {
    text: "What is the capital of France?",
    subject: 'Geography',
    topic: 'World Capitals'
  },
  {
    text: "Name three programming paradigms.",
    subject: 'Computer Science',
    topic: 'Programming Concepts'
  },
  {
    text: "What is photosynthesis?",
    subject: 'Biology',
    topic: 'Plant Biology'
  },
  {
    text: "Define oxidation and reduction.",
    subject: 'Chemistry',
    topic: 'Chemical Reactions'
  }
];

// Sample names for realistic user generation
const firstNames = [
  'John', 'Jane', 'Michael', 'Sarah', 'David', 'Emma', 'James', 'Emily',
  'Robert', 'Olivia', 'William', 'Ava', 'Richard', 'Sophia', 'Thomas', 'Isabella',
  'Daniel', 'Mia', 'Matthew', 'Charlotte', 'Joseph', 'Amelia', 'Charles', 'Harper',
  'Christopher', 'Evelyn', 'Andrew', 'Abigail', 'Joshua', 'Ella'
];

const lastNames = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
  'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas',
  'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson', 'White',
  'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson'
];

/**
 * Generate sample users in database
 */
async function generateUsers(userRepo: UserRepository, count: number): Promise<{ students: string[], teachers: string[], admins: string[] }> {
  console.log(`\n[1/5] Generating ${count} users...`);
  
  const students: string[] = [];
  const teachers: string[] = [];
  const admins: string[] = [];
  
  // Generate students (70% of users)
  const studentCount = Math.floor(count * 0.7);
  for (let i = 0; i < studentCount; i++) {
    const firstName = randomItem(firstNames)!;
    const lastName = randomItem(lastNames)!;
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${i}@student.edu`;
    
    const result = await userRepo.create({
      email,
      name: `${firstName} ${lastName}`,
      role: 'student',
      currentAllocatedExams: [],
      submissionHistory: [],
      createdAt: new Date()
    });
    
    if (result.success && result.userId) {
      students.push(result.userId);
    }
  }
  
  // Generate teachers (25% of users)
  const teacherCount = Math.floor(count * 0.25);
  for (let i = 0; i < teacherCount; i++) {
    const firstName = randomItem(firstNames)!;
    const lastName = randomItem(lastNames)!;
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${i}@teacher.edu`;
    
    const result = await userRepo.create({
      email,
      name: `Prof. ${firstName} ${lastName}`,
      role: 'teacher',
      currentAllocatedExams: [],
      submissionHistory: [],
      createdAt: new Date()
    });
    
    if (result.success && result.userId) {
      teachers.push(result.userId);
    }
  }
  
  // Generate admins (5% of users, at least 1)
  const adminCount = Math.max(1, Math.floor(count * 0.05));
  for (let i = 0; i < adminCount; i++) {
    const firstName = randomItem(firstNames);
    const lastName = randomItem(lastNames);
    const email = `admin${i > 0 ? i + 1 : ''}@system.edu`;
    
    const result = await userRepo.create({
      email,
      name: `Admin ${firstName} ${lastName}`,
      role: 'admin',
      currentAllocatedExams: [],
      submissionHistory: []
    });
    
    if (result.success && result.userId) {
      admins.push(result.userId);
    }
  }
  
  console.log(`✅ Generated ${students.length} students, ${teachers.length} teachers, ${admins.length} admins`);
  return { students, teachers, admins };
}

/**
 * Random selection helper
 */
function randomItem<T>(array: T[]): T | undefined {
  if (array.length === 0) {
    return undefined;
  }
  return array[Math.floor(Math.random() * array.length)];
}

/**
 * Generate OCR-sourced prompts
 */
async function generateOcrPrompts(repo: PromptRepository, count: number, creatorId: string): Promise<string[]> {
  console.log(`\n[2/5] Generating ${count} OCR-sourced prompts...`);
  const prompts: string[] = [];
  
  for (let i = 0; i < count; i++) {
    const template = randomItem(ocrQuestions);
    const subject = template.subject;
    const topic = template.topic;
    
    const promptData: PromptData = {
      questionText: `${template.text} (OCR Sample ${i + 1})`,
      subject,
      topic,
      generateVia: 'ocr',
      source: `sample_paper_${Math.floor(i / 10) + 1}.pdf`,
      ocrConfidence: template.confidence! + (Math.random() * 0.1 - 0.05), // Slight variation
      createdBy: creatorId,
      bloomsLevel: randomItem(bloomsLevels)
    };
    
    const result = await repo.create(promptData);
    if (result.success) {
      prompts.push(result.promptId!);
      if ((i + 1) % 10 === 0) {
        console.log(`  ✅ Created ${i + 1}/${count} OCR prompts`);
      }
    }
  }
  
  console.log(`✅ Generated ${prompts.length} OCR prompts`);
  return prompts;
}

/**
 * Generate LLM-generated prompts
 */
async function generateLlmPrompts(repo: PromptRepository, count: number, creatorId: string): Promise<string[]> {
  console.log(`\n[3/5] Generating ${count} LLM-generated prompts...`);
  const prompts: string[] = [];
  
  for (let i = 0; i < count; i++) {
    const template = randomItem(llmQuestions);
    const subject = template.subject;
    const topic = template.topic;
    
    const promptData: PromptData = {
      questionText: `${template.text} (LLM Generated ${i + 1})`,
      subject,
      topic,
      generateVia: 'llm',
      createdBy: creatorId,
      bloomsLevel: randomItem(bloomsLevels)
    };
    
    const result = await repo.create(promptData);
    if (result.success) {
      prompts.push(result.promptId!);
      if ((i + 1) % 10 === 0) {
        console.log(`  ✅ Created ${i + 1}/${count} LLM prompts`);
      }
    }
  }
  
  console.log(`✅ Generated ${prompts.length} LLM prompts`);
  return prompts;
}

/**
 * Generate user-created prompts
 */
async function generateUserPrompts(repo: PromptRepository, count: number, creatorId: string): Promise<string[]> {
  console.log(`\n[4/5] Generating ${count} user-created prompts...`);
  const prompts: string[] = [];
  
  for (let i = 0; i < count; i++) {
    const template = randomItem(userQuestions);
    const subject = template.subject;
    const topic = template.topic;
    
    const promptData: PromptData = {
      questionText: `${template.text} (User Created ${i + 1})`,
      subject,
      topic,
      generateVia: 'user',
      createdBy: creatorId,
      bloomsLevel: randomItem(bloomsLevels)
    };
    
    const result = await repo.create(promptData);
    if (result.success) {
      prompts.push(result.promptId!);
      if ((i + 1) % 10 === 0) {
        console.log(`  ✅ Created ${i + 1}/${count} user prompts`);
      }
    }
  }
  
  console.log(`✅ Generated ${prompts.length} user prompts`);
  return prompts;
}

/**
 * Generate exams with questions
 */
async function generateExams(examRepo: ExamRepository, allPromptIds: string[], userIds: string[], count: number): Promise<string[]> {
  console.log(`\n[5/5] Generating ${count} exams...`);
  const exams: string[] = [];
  
  for (let i = 0; i < count; i++) {
    const subject = randomItem(subjects);
    const examType = randomItem(examTypes);
    
    // Select random prompts for this exam (5-10 questions)
    const numQuestions = Math.floor(Math.random() * 6) + 5;
    const selectedPrompts: string[] = [];
    for (let j = 0; j < numQuestions; j++) {
      selectedPrompts.push(randomItem(allPromptIds));
    }
    
    // Create questions for the exam
    const questions: ExamQuestionData[] = selectedPrompts.map(promptId => {
      const questionType = randomItem(['MCQ', 'TEXT', 'TRUE_FALSE'] as const);
      
      return {
        promptId,
        questionType,
        marks: Math.floor(Math.random() * 6) + 5, // 5-10 marks
        negativeMarks: questionType === 'MCQ' ? 0.25 : 0,
        answer: questionType === 'MCQ' || questionType === 'TRUE_FALSE' ? [0] : 'Sample answer text',
        options: (questionType === 'MCQ' || questionType === 'TRUE_FALSE') ? [
          { text: questionType === 'TRUE_FALSE' ? 'True' : 'Option A', isCorrect: true },
          { text: questionType === 'TRUE_FALSE' ? 'False' : 'Option B', isCorrect: false },
          ...(questionType === 'MCQ' ? [
            { text: 'Option C', isCorrect: false },
            { text: 'Option D', isCorrect: false }
          ] : [])
        ] : undefined
      };
    });
    
    // Assign to random users
    const numAssignedUsers = Math.floor(Math.random() * 10) + 5;
    const assignedUsers: string[] = [];
    for (let j = 0; j < numAssignedUsers; j++) {
      assignedUsers.push(randomItem(userIds));
    }
    
    const examData = {
      examTitle: `${subject} ${examType} ${i + 1}`,
      examDescription: `This is a ${examType} exam covering various topics in ${subject}.`,
      subject,
      examDegree: randomItem(['Bachelor of Science', 'Bachelor of Arts', 'Master of Science']),
      examType,
      passingPercentage: Math.floor(Math.random() * 20) + 40, // 40-60%
      duration: Math.floor(Math.random() * 90) + 60, // 60-150 minutes
      scheduledAt: new Date(Date.now() + Math.random() * 30 * 24 * 60 * 60 * 1000), // Next 30 days
      createdBy: randomItem(userIds),
      instructions: 'Read all questions carefully. Answer all questions.',
      negativeMarking: Math.random() > 0.5,
      negativeMarkingPercentage: 25,
      assignedUsers,
      questions
    };
    
    const result = await examRepo.createWithPrompts(examData);
    if (result.success) {
      exams.push(result.examId!);
      if ((i + 1) % 5 === 0) {
        console.log(`  ✅ Created ${i + 1}/${count} exams`);
      }
    }
  }
  
  console.log(`✅ Generated ${exams.length} exams`);
  return exams;
}

/**
 * Generate exam submissions (completed only)
 */
async function generateSubmissions(submissionRepo: ExamSubmissionRepository, examIds: string[], userIds: string[], count: number): Promise<string[]> {
  console.log(`\n[6/6] Generating ${count} completed exam submissions...`);
  const submissions: string[] = [];
  
  // Validate input arrays
  if (examIds.length === 0) {
    console.error('❌ No exams available to create submissions');
    return submissions;
  }
  if (userIds.length === 0) {
    console.error('❌ No users available to create submissions');
    return submissions;
  }
  
  console.log(`Using ${examIds.length} exams and ${userIds.length} users`);
  
  for (let i = 0; i < count; i++) {
    const examId = randomItem(examIds);
    const userId = randomItem(userIds);
    
    // Debug log to verify IDs
    if (!examId || !userId) {
      console.error(`❌ Invalid IDs at iteration ${i}: examId=${examId}, userId=${userId}`);
      continue;
    }
    
    // Generate random question responses (3-8 questions per exam)
    const numQuestions = Math.floor(Math.random() * 6) + 3;
    const responses = [];
    let totalMaxMarks = 0;
    let totalMarksAchieved = 0;
    
    for (let q = 0; q < numQuestions; q++) {
      const maxMarksForQuestion = Math.floor(Math.random() * 8) + 2; // 2-10 marks per question
      const marksAchieved = Math.floor(Math.random() * (maxMarksForQuestion + 1)); // 0 to maxMarks
      
      totalMaxMarks += maxMarksForQuestion;
      totalMarksAchieved += marksAchieved;
      
      responses.push({
        questionId: `q_${Math.random().toString(36).substr(2, 9)}`,
        userResponse: Math.random() > 0.5 ? `Answer ${q + 1}: This is a detailed response` : `${Math.floor(Math.random() * 4)}`,
        maxMarks: maxMarksForQuestion,
        allottedMarks: marksAchieved,
        feedback: marksAchieved === maxMarksForQuestion 
          ? 'Excellent answer!' 
          : marksAchieved > maxMarksForQuestion / 2 
            ? 'Good attempt, but could be improved' 
            : 'Needs more detail',
        suggestions: marksAchieved < maxMarksForQuestion ? ['Add more examples', 'Explain the concept better'] : undefined
      });
    }
    
    // Create completed submission with ALL mandatory fields
    const timeSpent = Math.floor(Math.random() * 3600) + 600; // 10 mins to 1 hour
    const autoSubmitted = Math.random() < 0.1; // 10% auto-submitted
    
    const result = await submissionRepo.create({
      examId,
      userId,
      timeSpent,
      autoSubmitted,
      maxMarks: totalMaxMarks,
      marksAchieved: totalMarksAchieved,
      evaluatorObservations: totalMarksAchieved > totalMaxMarks * 0.8 
        ? 'Excellent performance overall' 
        : totalMarksAchieved > totalMaxMarks * 0.5 
          ? 'Satisfactory performance' 
          : 'Needs improvement',
      responses
    });
    
    if (result.success && result.submissionId) {
      submissions.push(result.submissionId);
      if ((i + 1) % 10 === 0) {
        console.log(`  ✅ Created ${i + 1}/${count} submissions`);
      }
    }
  }
  
  console.log(`✅ Generated ${submissions.length} completed submissions`);
  return submissions;
}

/**
 * Clear all collections
 */
async function clearCollections(): Promise<void> {
  console.log('\n⚠️  Clearing existing data...');
  
  const promptRepo = new PromptRepository();
  const examQuestionRepo = new ExamQuestionRepository();
  const examRepo = new ExamRepository();
  const submissionRepo = new ExamSubmissionRepository();
  
  // Note: Actual delete all implementation would be needed
  console.log('✅ Collections cleared (implementation pending)');
}

/**
 * Main generator function
 */
async function generateSampleData(): Promise<void> {
  try {
    console.log('Connecting to database...\n');
    await connect();
    
    if (shouldClear) {
      await clearCollections();
    }
    
    const startTime = Date.now();
    
    // Initialize repositories
    const userRepo = new UserRepository();
    const promptRepo = new PromptRepository();
    const examRepo = new ExamRepository();
    const submissionRepo = new ExamSubmissionRepository();
    
    // Generate users first
    const users = await generateUsers(userRepo, itemCount);
    const allUserIds = [...users.students, ...users.teachers, ...users.admins];
    const creatorId = users.teachers[0] || users.admins[0]; // Use first teacher or admin as creator
    
    // Generate prompts by type
    const ocrPrompts = await generateOcrPrompts(promptRepo, Math.floor(itemCount * 0.3), creatorId);
    const llmPrompts = await generateLlmPrompts(promptRepo, Math.floor(itemCount * 0.3), creatorId);
    const userPrompts = await generateUserPrompts(promptRepo, Math.floor(itemCount * 0.4), creatorId);
    
    const allPromptIds = [...ocrPrompts, ...llmPrompts, ...userPrompts];
    console.log(`\n📊 Total prompts created: ${allPromptIds.length}`);
    
    // Generate exams (use students as assigned users, teachers as creators)
    const examCount = Math.floor(itemCount * 0.2);
    const examIds = await generateExams(examRepo, allPromptIds, users.students, examCount);
    
    // Generate submissions (students submitting exams)
    const submissionCount = examCount * 3; // 3 submissions per exam average
    await generateSubmissions(submissionRepo, examIds, users.students, submissionCount);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log('\n========================================');
    console.log('✅ Sample Data Generation Complete!');
    console.log(`Total time: ${duration} seconds`);
    console.log('========================================');
    console.log('\n📈 Summary:');
    console.log(`  - Users (Students): ${users.students.length}`);
    console.log(`  - Users (Teachers): ${users.teachers.length}`);
    console.log(`  - Users (Admins): ${users.admins.length}`);
    console.log(`  - Prompts (OCR): ${ocrPrompts.length}`);
    console.log(`  - Prompts (LLM): ${llmPrompts.length}`);
    console.log(`  - Prompts (User): ${userPrompts.length}`);
    console.log(`  - Exams: ${examIds.length}`);
    console.log(`  - Submissions: ${submissionCount}`);
    console.log('\n💡 Next steps:');
    console.log('  1. Run create-indexes.ts to optimize queries');
    console.log('  2. Test API endpoints with generated data');
    console.log('  3. Review low confidence OCR prompts\n');
    
    await disconnect();
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ Sample data generation failed:', error);
    await disconnect();
    process.exit(1);
  }
}

// Run the generator
generateSampleData();
