/**
 * Import Script for Bedrock-enriched Question Papers
 * 
 * This script imports questions from AWS Bedrock processed JSON files
 * with Bloom's taxonomy enrichment into MongoDB.
 * 
 * Structure expected:
 * {
 *   "exams": [{
 *     "subject": "...",
 *     "subjectCode": "...",
 *     "branch": "...",
 *     "year": "...",
 *     "semester": "...",
 *     "examType": "main" | "kt",
 *     "max_marks": "...",
 *     "institutionName": "...",
 *     "questions": [{
 *       "question_text": "...",
 *       "marks": "...",
 *       "questionType": "text" | "mcq" | ...,
 *       "options": [...],  // for MCQs
 *       "bloomLevel": "Recall" | "Understand" | ...,
 *       "bloomJustification": "...",
 *       "confidence": 0.88,
 *       "difficulty": "Easy" | "Medium" | "Hard",
 *       "keywords": [...],
 *       "topicsCovered": [...]
 *     }]
 *   }],
 *   "subjectsCreated": [...]
 * }
 */

import fs from 'fs/promises';
import path from 'path';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

// Import models
import { model, models } from 'mongoose';
import { zodSchema } from '@zodyac/zod-mongoose';
import { 
  promptZodSchema,
  uniqueQuestionZod,
  analysisReportZodSchema,
  subjectDocumentZodSchema,
  subjectSchemaOptions
} from '../database/schemas/index.js';

// Create models
const promptSchema = zodSchema(promptZodSchema, { timestamps: true });
const PromptModel = models.Prompt || model('Prompt', promptSchema);

const uniqueQuestionSchema = zodSchema(uniqueQuestionZod, { timestamps: true });
uniqueQuestionSchema.index({ normalizedText: 1, subject: 1 });
const UniqueQuestionModel = models.UniqueQuestion || model('UniqueQuestion', uniqueQuestionSchema);

const analysisReportSchema = zodSchema(analysisReportZodSchema, { timestamps: true });
const AnalysisReportModel = models.AnalysisReport || model('AnalysisReport', analysisReportSchema);

const subjectSchema = zodSchema(subjectDocumentZodSchema, subjectSchemaOptions);
const SubjectModel = models.Subject || model('Subject', subjectSchema);

/**
 * Normalize question text for deduplication
 */
function normalizeQuestionText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '') // Remove punctuation
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
}

/**
 * Find or create UniqueQuestion
 */
async function findOrCreateUniqueQuestion(
  question: any,
  exam: any,
  promptId: string,
  analysisReportId: string
) {
  const normalizedText = normalizeQuestionText(question.question_text);
  
  const appearance = {
    year: exam.year || 'Unknown',
    semester: exam.semester || 'S1',
    examType: exam.examType || 'main',
    analysisReportId: analysisReportId,
  };

  // Try to find existing question
  const existing = await UniqueQuestionModel.findOne({
    normalizedText,
    subject: exam.subject,
  });

  if (existing) {
    // Update occurrence count and appearances
    existing.occurrenceCount += 1;
    existing.lastSeenAt = new Date();
    existing.appearances.push(appearance);
    existing.sourceReports.push(analysisReportId);
    existing.promptIds.push(promptId);
    
    // Update Bloom's data if available and not already set
    if (question.bloomLevel && !existing.bloomLevel) {
      existing.bloomLevel = question.bloomLevel;
      existing.bloomJustification = question.bloomJustification;
      existing.confidence = question.confidence;
      existing.difficulty = question.difficulty;
      existing.keywords = question.keywords || [];
      existing.topicsCovered = question.topicsCovered || [];
    }
    
    await existing.save();
    return existing;
  }

  // Create new unique question
  const uniqueQuestion = await UniqueQuestionModel.create({
    questionText: question.question_text,
    normalizedText,
    subject: exam.subject,
    subjectCode: exam.subjectCode,
    branch: exam.branch,
    questionType: question.questionType,
    options: question.options,
    marks: question.marks,
    bloomLevel: question.bloomLevel,
    bloomJustification: question.bloomJustification,
    confidence: question.confidence,
    difficulty: question.difficulty,
    keywords: question.keywords || [],
    topicsCovered: question.topicsCovered || [],
    sourceReports: [analysisReportId],
    occurrenceCount: 1,
    appearances: [appearance],
    promptIds: [promptId],
    firstSeenAt: new Date(),
    lastSeenAt: new Date(),
    isActive: true,
    isVerified: false,
  });

  return uniqueQuestion;
}

/**
 * Calculate Bloom's distribution from questions
 */
function calculateBloomDistribution(questions: any[]) {
  const distribution = {
    Recall: 0,
    Understand: 0,
    Apply: 0,
    Analyze: 0,
    Evaluate: 0,
    Create: 0,
  };

  const totalMarks = questions.reduce((sum, q) => {
    const marks = parseInt(q.marks) || 0;
    return sum + marks;
  }, 0);

  if (totalMarks === 0) {
    return distribution;
  }

  questions.forEach(q => {
    const marks = parseInt(q.marks) || 0;
    const percentage = (marks / totalMarks) * 100;
    const level = q.bloomLevel as keyof typeof distribution;
    
    if (level && distribution.hasOwnProperty(level)) {
      distribution[level] += percentage;
    }
  });

  return distribution;
}

/**
 * Import a single enriched JSON file
 */
async function importEnrichedFile(filePath: string) {
  console.log(`\n📄 Processing: ${path.basename(filePath)}`);
  
  try {
    const fileContent = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(fileContent);

    if (!data.exams || !Array.isArray(data.exams)) {
      console.log('  ⚠️  No exams found in file, skipping');
      return { success: false, error: 'No exams array' };
    }

    let totalPrompts = 0;
    let totalReports = 0;

    for (const exam of data.exams) {
      if (!exam.questions || exam.questions.length === 0) {
        console.log(`  ⚠️  No questions in exam: ${exam.subject}`);
        continue;
      }

      console.log(`\n  📚 Importing: ${exam.subject}`);
      console.log(`     Year: ${exam.year}, Semester: ${exam.semester}`);
      console.log(`     Questions: ${exam.questions.length}`);

      // Create Prompt documents for each question
      const promptIds: string[] = [];
      
      for (const question of exam.questions) {
        const prompt = await PromptModel.create({
          questionText: question.question_text,
          subject: exam.subject,
          subjectCode: exam.subjectCode,
          branch: exam.branch,
          questionType: question.questionType,
          options: question.options,
          marks: question.marks,
          bloomLevel: question.bloomLevel,
          bloomJustification: question.bloomJustification,
          confidence: question.confidence,
          difficulty: question.difficulty,
          keywords: question.keywords || [],
          topicsCovered: question.topicsCovered || [],
          generateVia: 'bedrock',
          source: path.basename(filePath),
          createdAt: new Date(),
        });

        promptIds.push(prompt._id.toString());
        totalPrompts++;
      }

      // Calculate Bloom's distribution
      const bloomDistribution = calculateBloomDistribution(exam.questions);

      // Create AnalysisReport
      const analysisReport = await AnalysisReportModel.create({
        subjectCode: exam.subjectCode,
        subjectName: exam.subject,
        branch: exam.branch,
        institutionName: exam.institutionName,
        year: exam.year || 'Unknown',
        semester: exam.semester || 'S1',
        examType: exam.examType || 'main',
        maxMarks: exam.max_marks,
        questionIds: promptIds,
        totalQuestions: exam.questions.length,
        totalMarks: parseInt(exam.max_marks) || undefined,
        bloomDistribution,
        originalFileName: path.basename(filePath),
        originalFileUrl: filePath,
        source: 'bedrock',
        publishedAt: new Date(),
        isPublic: true,
        isVerified: false,
        isActive: true,
      });

      totalReports++;

      // Create/Update UniqueQuestions
      for (let i = 0; i < exam.questions.length; i++) {
        await findOrCreateUniqueQuestion(
          exam.questions[i],
          exam,
          promptIds[i],
          analysisReport._id.toString()
        );
      }

      // Find or create Subject and link report
      let subject = await SubjectModel.findOne({ subjectName: exam.subject });
      
      if (!subject) {
        subject = await SubjectModel.create({
          subjectName: exam.subject,
          subjectDescription: `${exam.subject} - Auto-created from Bedrock import`,
          subjectDegree: exam.branch || 'General',
          subjectMarks: exam.max_marks || '100',
          subjectUsers: [],
          analysisReportIds: [analysisReport._id.toString()],
        });
        console.log(`  ✨ Created new subject: ${exam.subject}`);
      } else {
        // Add report to existing subject
        if (!subject.analysisReportIds.includes(analysisReport._id.toString())) {
          subject.analysisReportIds.push(analysisReport._id.toString());
          await subject.save();
        }
        console.log(`  ✓ Linked to existing subject: ${exam.subject}`);
      }

      console.log(`  ✓ Created ${exam.questions.length} prompts`);
      console.log(`  ✓ Created analysis report`);
      console.log(`  🎯 Bloom's: R:${bloomDistribution.Recall.toFixed(1)}% U:${bloomDistribution.Understand.toFixed(1)}% A:${bloomDistribution.Apply.toFixed(1)}%`);
    }

    console.log(`\n  ✅ File complete: ${totalPrompts} prompts, ${totalReports} reports`);
    return { success: true, prompts: totalPrompts, reports: totalReports };

  } catch (error: any) {
    console.error(`  ❌ Error processing file: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Main import function
 */
async function main() {
  const enrichedDir = process.argv[2] || 'C:/project/miniproject/ai_pipeline/enrichedQuestions';

  console.log('=' .repeat(60));
  console.log('BEDROCK ENRICHED QUESTIONS IMPORT');
  console.log('=' .repeat(60));
  console.log(`Directory: ${enrichedDir}`);

  try {
    // Connect to MongoDB
    const mongoUri = process.env.mongodb_url;
    if (!mongoUri) {
      throw new Error('mongodb_url not found in environment variables');
    }

    await mongoose.connect(mongoUri);
    console.log('✓ Connected to MongoDB');

    // Find all enriched JSON files
    const files = await fs.readdir(enrichedDir);
    const jsonFiles = files.filter(f => f.endsWith('_enriched.json'));

    console.log(`Found ${jsonFiles.length} enriched JSON files`);
    console.log('=' .repeat(60));

    let totalSuccess = 0;
    let totalFailed = 0;
    let totalPrompts = 0;
    let totalReports = 0;

    for (const file of jsonFiles) {
      const filePath = path.join(enrichedDir, file);
      const result = await importEnrichedFile(filePath);

      if (result.success) {
        totalSuccess++;
        totalPrompts += result.prompts || 0;
        totalReports += result.reports || 0;
      } else {
        totalFailed++;
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('IMPORT SUMMARY');
    console.log('='.repeat(60));
    console.log(`✓ Successful: ${totalSuccess}`);
    console.log(`✗ Failed: ${totalFailed}`);
    console.log(`📝 Total Prompts: ${totalPrompts}`);
    console.log(`📊 Total Reports: ${totalReports}`);
    console.log('='.repeat(60));

  } catch (error: any) {
    console.error('Fatal error:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

// Run the import
main();
