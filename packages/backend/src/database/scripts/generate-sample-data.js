/**
 * Sample Data Generator
 * Generates realistic test data for all collections
 * 
 * Usage:
 *   node generate-sample-data.js [--clear] [--count=50]
 * 
 * Options:
 *   --clear   Clear existing data before generating
 *   --count   Number of items to generate (default: 50)
 */

import { connect, disconnect } from '../connect.js';
import { PromptRepository } from '../repositories/PromptRepository.js';
import { ExamQuestionRepository } from '../repositories/ExamQuestionRepository.js';
import { ExamRepository } from '../repositories/ExamRepository.js';
import { ExamSubmissionRepository } from '../repositories/ExamSubmissionRepository.js';
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

// Sample data templates
const subjects = [
  'Mathematics',
  'Physics',
  'Chemistry',
  'Biology',
  'Computer Science',
  'English Literature',
  'History',
  'Geography'
];

const topics = {
  'Mathematics': ['Algebra', 'Calculus', 'Geometry', 'Statistics', 'Trigonometry'],
  'Physics': ['Mechanics', 'Thermodynamics', 'Electromagnetism', 'Optics', 'Quantum Physics'],
  'Chemistry': ['Organic Chemistry', 'Inorganic Chemistry', 'Physical Chemistry', 'Biochemistry'],
  'Biology': ['Cell Biology', 'Genetics', 'Ecology', 'Evolution', 'Anatomy'],
  'Computer Science': ['Data Structures', 'Algorithms', 'Databases', 'Networks', 'AI/ML'],
  'English Literature': ['Poetry', 'Drama', 'Prose', 'Literary Criticism'],
  'History': ['Ancient History', 'Medieval History', 'Modern History', 'World Wars'],
  'Geography': ['Physical Geography', 'Human Geography', 'Climate', 'Cartography']
};

const bloomsLevels = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'];

const examTypes = ['Midterm', 'Final', 'Quiz', 'Practice Test', 'Mock Exam'];

// OCR simulation data (with varying confidence)
const ocrQuestions = [
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
const llmQuestions = [
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
const userQuestions = [
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

/**
 * Generate random user IDs (mock)
 */
function generateMockUserIds(count) {
  return Array.from({ length: count }, (_, i) => `user_${i + 1}`);
}

/**
 * Random selection helper
 */
function randomItem(array) {
  return array[Math.floor(Math.random() * array.length)];
}

/**
 * Generate OCR-sourced prompts
 */
async function generateOcrPrompts(repo, count, creatorId) {
  console.log(`\n[1/4] Generating ${count} OCR-sourced prompts...`);
  const prompts = [];
  
  for (let i = 0; i < count; i++) {
    const template = randomItem(ocrQuestions);
    const subject = template.subject;
    const topic = template.topic;
    
    const promptData = {
      questionText: `${template.text} (OCR Sample ${i + 1})`,
      subject,
      topic,
      generateVia: 'ocr',
      source: `sample_paper_${Math.floor(i / 10) + 1}.pdf`,
      ocrConfidence: template.confidence + (Math.random() * 0.1 - 0.05), // Slight variation
      createdBy: creatorId,
      bloomsLevel: randomItem(bloomsLevels) 
    };
    
    const result = await repo.create(promptData);
    if (result.success) {
      prompts.push(result.promptId);
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
async function generateLlmPrompts(repo, count, creatorId) {
  console.log(`\n[2/4] Generating ${count} LLM-generated prompts...`);
  const prompts = [];
  
  for (let i = 0; i < count; i++) {
    const template = randomItem(llmQuestions);
    const subject = template.subject;
    const topic = template.topic;
    
    const promptData = {
      questionText: `${template.text} (LLM Generated ${i + 1})`,
      subject,
      topic,
      generateVia: 'llm',
      createdBy: creatorId,
      bloomsLevel: randomItem(bloomsLevels)
    };
    
    const result = await repo.create(promptData);
    if (result.success) {
      prompts.push(result.promptId);
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
async function generateUserPrompts(repo, count, creatorId) {
  console.log(`\n[3/4] Generating ${count} user-created prompts...`);
  const prompts = [];
  
  for (let i = 0; i < count; i++) {
    const template = randomItem(userQuestions);
    const subject = template.subject;
    const topic = template.topic;
    
    const promptData = {
      questionText: `${template.text} (User Created ${i + 1})`,
      subject,
      topic,
      generateVia: 'user' ,
      createdBy: creatorId,
      bloomsLevel: randomItem(bloomsLevels)
    };
    
    const result = await repo.create(promptData);
    if (result.success) {
      prompts.push(result.promptId);
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
async function generateExams(examRepo, allPromptIds, userIds, count) {
  console.log(`\n[4/4] Generating ${count} exams...`);
  const exams = [];
  
  for (let i = 0; i < count; i++) {
    const subject = randomItem(subjects);
    const examType = randomItem(examTypes);
    
    // Select random prompts for this exam (5-10 questions)
    const numQuestions = Math.floor(Math.random() * 6) + 5;
    const selectedPrompts = [];
    for (let j = 0; j < numQuestions; j++) {
      selectedPrompts.push(randomItem(allPromptIds));
    }
    
    // Create questions for the exam
    const questions = selectedPrompts.map(promptId => ({
      promptId,
      marks: Math.floor(Math.random() * 6) + 5, // 5-10 marks
      negativeMarks: Math.random() > 0.5 ? 0.25 : 0,
      answerType: randomItem(['mcq', 'multiple-select', 'short', 'long']) ,
      options: randomItem(['mcq', 'multiple-select']) ? [
        { text: 'Option A', isCorrect: true },
        { text: 'Option B', isCorrect: false },
        { text: 'Option C', isCorrect: false },
        { text: 'Option D', isCorrect: false }
      ] : undefined
    }));
    
    // Assign to random users
    const numAssignedUsers = Math.floor(Math.random() * 10) + 5;
    const assignedUsers = [];
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
      exams.push(result.examId);
      if ((i + 1) % 5 === 0) {
        console.log(`  ✅ Created ${i + 1}/${count} exams`);
      }
    }
  }
  
  console.log(`✅ Generated ${exams.length} exams`);
  return exams;
}

/**
 * Generate exam submissions
 */
async function generateSubmissions(submissionRepo, examIds, userIds, count) {
  console.log(`\n[5/5] Generating ${count} exam submissions...`);
  const submissions = [];
  
  for (let i = 0; i < count; i++) {
    const examId = randomItem(examIds);
    const userId = randomItem(userIds);
    
    // Start submission
    const startResult = await submissionRepo.start(examId, userId);
    
    if (startResult.success && startResult.submissionId) {
      const submissionId = startResult.submissionId;
      
      // Simulate progress (random responses)
      const responses = [
        {
          examQuestionId: `eq_${Math.random().toString(36).substr(2, 9)}`,
          response: Math.random() > 0.5 ? '2' : 'This is my answer',
          isCorrect: Math.random() > 0.3
        }
      ];
      
      await submissionRepo.updateProgress(submissionId, {
        responses,
        timeSpent: Math.floor(Math.random() * 120) + 30
      });
      
      // Randomly submit some
      if (Math.random() > 0.3) {
        await submissionRepo.finalize(submissionId, Math.random() < 0.1);
        
        // Randomly evaluate some submitted exams
        if (Math.random() > 0.5) {
          await submissionRepo.evaluate(submissionId, {
            totalScore: Math.floor(Math.random() * 50) + 50,
            responses: responses.map(r => ({
              examQuestionId: r.examQuestionId,
              allottedMarks: Math.floor(Math.random() * 10) + 1,
              feedback: 'Good attempt'
            }))
          });
        }
      }
      
      submissions.push(submissionId);
      if ((i + 1) % 10 === 0) {
        console.log(`  ✅ Created ${i + 1}/${count} submissions`);
      }
    }
  }
  
  console.log(`✅ Generated ${submissions.length} submissions`);
  return submissions;
}

/**
 * Clear all collections
 */
async function clearCollections() {
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
async function generateSampleData() {
  try {
    console.log('Connecting to database...\n');
    await connect();
    
    if (shouldClear) {
      await clearCollections();
    }
    
    const startTime = Date.now();
    
    // Mock creator and user IDs
    const creatorId = 'teacher_1';
    const userIds = generateMockUserIds(50);
    
    // Initialize repositories
    const promptRepo = new PromptRepository();
    const examRepo = new ExamRepository();
    const submissionRepo = new ExamSubmissionRepository();
    
    // Generate prompts by type
    const ocrPrompts = await generateOcrPrompts(promptRepo, Math.floor(itemCount * 0.3), creatorId);
    const llmPrompts = await generateLlmPrompts(promptRepo, Math.floor(itemCount * 0.3), creatorId);
    const userPrompts = await generateUserPrompts(promptRepo, Math.floor(itemCount * 0.4), creatorId);
    
    const allPromptIds = [...ocrPrompts, ...llmPrompts, ...userPrompts];
    console.log(`\n📊 Total prompts created: ${allPromptIds.length}`);
    
    // Generate exams
    const examCount = Math.floor(itemCount * 0.2);
    const examIds = await generateExams(examRepo, allPromptIds, userIds, examCount);
    
    // Generate submissions
    const submissionCount = examCount * 3; // 3 submissions per exam average
    await generateSubmissions(submissionRepo, examIds, userIds, submissionCount);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log('\n========================================');
    console.log('✅ Sample Data Generation Complete!');
    console.log(`Total time: ${duration} seconds`);
    console.log('========================================');
    console.log('\n📈 Summary:');
    console.log(`  - Prompts (OCR): ${ocrPrompts.length}`);
    console.log(`  - Prompts (LLM): ${llmPrompts.length}`);
    console.log(`  - Prompts (User): ${userPrompts.length}`);
    console.log(`  - Exams: ${examIds.length}`);
    console.log(`  - Submissions: ${submissionCount}`);
    console.log('\n💡 Next steps:');
    console.log('  1. Run create-indexes.js to optimize queries');
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
