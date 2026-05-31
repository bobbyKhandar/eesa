/**
 * Script to import OCR questions from questionPapers directory into the database
 * 
 * Directory structure: outputs/questionPapers/{subjectName}/{year-metadata.txt}
 * Each txt file contains JSON5 array of questions with 'question' and 'level' properties
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import JSON5 from 'json5';
import { connect } from '../database/connect.js';
import { getPromptModel } from '../database/mongooseSchemas.js';
import { getSubjectModel } from '../database/mongooseSchemas.js';
import { UniqueQuestionRepository } from '../database/repositories/UniqueQuestionRepository.js';
import { AnalysisReportRepository } from '../database/repositories/AnalysisReportRepository.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Map Bloom's levels from OCR format to database format
const BLOOM_LEVEL_MAP: Record<string, string> = {
  'Remember': 'remember',
  'Understand': 'understand',
  'Apply': 'apply',
  'Analyze': 'analyze',
  'Evaluate': 'evaluate',
  'Create': 'create'
};

// Base path for question papers
const QUESTION_PAPERS_PATH = path.join(__dirname, '../../../outputs/questionPapers');

interface FileMetadata {
  year?: string;
  originalFileName: string;
  metadata: string;
}

interface QuestionData {
  questionText: string;
  bloomsLevel?: string;
  subject: string;
  source: string;
  generateVia: string;
  year?: string;
  metadata: string;
  createdBy: string;
}

interface ImportResult {
  imported: number;
  skipped: number;
  updated: number; // Track updated unique questions
}

/**
 * Normalize question text for deduplication
 * Removes extra whitespace, punctuation, and converts to lowercase
 */
function normalizeQuestionText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ') // Remove punctuation
    .replace(/\s+/g, ' ')      // Normalize whitespace
    .trim();
}

/**
 * Parse filename to extract metadata
 * Format: year-metadata-branch-sem-etc-SubjectName.txt
 */
function parseFilename(filename: string): FileMetadata {
  const parts = filename.replace('.txt', '').split('-');
  
  return {
    year: parts[0] || undefined,
    originalFileName: filename,
    // Extract additional metadata from filename
    metadata: parts.slice(1).join('-')
  };
}

/**
 * Parse JSON5-like content from file
 * Handles undefined and null values using JSON5 parser
 */
function parseQuestions(content: string, fallbackSubjectName: string, fileMetadata: FileMetadata): QuestionData[] {
  try {
    // Use JSON5 parser which handles unquoted keys, trailing commas, comments, etc.
    let parsed = JSON5.parse(content);
    let subjectName = fallbackSubjectName; // Default to directory name
    
    // Handle case where content is an object like {'SubjectName': [...]}
    if (!Array.isArray(parsed)) {
      // If it's an object, try to extract the array from it
      if (typeof parsed === 'object' && parsed !== null) {
        // Get the first property value if it's an array
        const keys = Object.keys(parsed);
        if (keys.length > 0) {
          // Use the key as the subject name (e.g., 'Operating System' from {'Operating System': [...]})
          subjectName = keys[0];
          console.log(`  📌 Extracted subject name from JSON: "${subjectName}"`);
          const firstValue = parsed[keys[0]];
          if (Array.isArray(firstValue)) {
            parsed = firstValue;
          } else {
            console.warn(`Content is not an array in file: ${fileMetadata.originalFileName}`);
            return [];
          }
        } else {
          console.warn(`Content is not an array in file: ${fileMetadata.originalFileName}`);
          return [];
        }
      } else {
        console.warn(`Content is not an array in file: ${fileMetadata.originalFileName}`);
        return [];
      }
    } else {
      // Array format - use directory name
      console.log(`  📁 Using directory name as subject: "${subjectName}"`);
    }
    
    const questions = parsed;
    
    // Filter out null/undefined questions and validate
    const validQuestions = questions.filter((q: any) => {
      return q && 
             q.question && 
             typeof q.question === 'string' && 
             q.question.trim() !== '' &&
             q.question !== 'null' &&
             q.question !== 'undefined';
    }).map((q: any) => ({
      questionText: q.question.trim(),
      bloomsLevel: BLOOM_LEVEL_MAP[q.level] || undefined,
      subject: subjectName,
      source: fileMetadata.originalFileName,
      generateVia: 'ocr',
      year: fileMetadata.year,
      metadata: fileMetadata.metadata,
      createdBy: 'system-ocr-import'
    }));
    
    return validQuestions;
  } catch (error: any) {
    console.error(`Error parsing questions from ${fileMetadata.originalFileName}:`, error.message);
    return [];
  }
}

/**
 * Get or create subject in database
 */
async function getOrCreateSubject(subjectName: string) {
  const SubjectModel = getSubjectModel();
  
  let subject = await SubjectModel.findOne({ subjectName });
  
  if (!subject) {
    subject = await SubjectModel.create({
      subjectName,
      subjectDescription: `Question bank for ${subjectName} (imported from OCR)`,
      subjectDegree: 'General',
      subjectMarks: '100',
      subjectUsers: [],
      subjectOngoingExams: [],
      subjectReview: [],
      numberOfReviews: 0,
      totalRating: 0,
      subjectPyq: [],
      subjectSyllabus: `Syllabus for ${subjectName}`,
      analysisReportIds: []
    });
    console.log(`✓ Created subject: ${subjectName}`);
  }
  
  return subject;
}

/**
 * Import questions for a single file and create AnalysisReport
 */
async function importQuestionsFromFile(filePath: string, subjectName: string): Promise<ImportResult> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const filename = path.basename(filePath);
    const fileMetadata = parseFilename(filename);
    
    // Parse questions from file
    const questions = parseQuestions(content, subjectName, fileMetadata);
    
    if (questions.length === 0) {
      console.log(`  ⚠ No valid questions found in: ${filename}`);
      return { imported: 0, skipped: 0, updated: 0 };
    }
    
    // Get models and repositories
    const PromptModel = getPromptModel();
    const uniqueQuestionRepo = new UniqueQuestionRepository();
    const analysisReportRepo = new AnalysisReportRepository();
    
    let imported = 0;
    let skipped = 0;
    let updated = 0;
    const promptIds: string[] = [];
    
    // Use default values since metadata is not in JSON5 data
    const semester = 'Not available';
    const examType: 'main' | 'kt' = 'main';
    
    // Calculate Bloom's distribution
    const bloomCounts = {
      remember: 0,
      understand: 0,
      apply: 0,
      analyze: 0,
      evaluate: 0,
      create: 0,
    };
    
    // Import each question
    for (const questionData of questions) {
      try {
        // Normalize question text for deduplication
        const normalizedText = normalizeQuestionText(questionData.questionText);
        
        // Check if prompt already exists
        const existingPrompt = await PromptModel.findOne({
          questionText: questionData.questionText,
          subject: questionData.subject
        });
        
        let promptId: string;
        
        if (existingPrompt) {
          // Reuse existing prompt
          promptId = existingPrompt._id.toString();
          skipped++;
        } else {
          // Create new prompt
          const newPrompt = await PromptModel.create(questionData);
          promptId = newPrompt._id.toString();
          imported++;
          
          if (imported === 1) {
            console.log(`  ✓ Creating new prompts for subject: "${questionData.subject}"`);
          }
        }
        
        promptIds.push(promptId);
        
        // Track bloom level
        if (questionData.bloomsLevel) {
          const level = questionData.bloomsLevel.toLowerCase();
          if (level in bloomCounts) {
            bloomCounts[level as keyof typeof bloomCounts]++;
          }
        }
        
        // Always update/create unique question to track occurrences
        const uniqueQuestionData: any = {
          questionText: questionData.questionText,
          normalizedText,
          subject: questionData.subject,
          topics: [], // Can be enhanced later with topic extraction
          bloomsLevel: questionData.bloomsLevel as any,
          promptIds: [promptId],
          tags: [],
          isVerified: false,
          isActive: true,
          sourceReports: [], // Will be populated by findOrCreate
          occurrenceCount: 1, // Will be managed by findOrCreate
          firstSeenAt: new Date(),
          lastSeenAt: new Date(),
          appearances: [], // Will be populated by findOrCreate
          // Required by findOrCreate - use default values
          analysisReportId: `ocr-import-${filename}`,
          year: 'Not available',
          semester: 'Not available',
          examType: 'main',
        };
        
        const { isNew } = await uniqueQuestionRepo.findOrCreate(uniqueQuestionData);
        
        if (!isNew) {
          updated++;
          if (updated === 1) {
            console.log(`  📊 Tracking occurrences in unique questions`);
          }
        }
        
      } catch (error: any) {
        console.error(`  ✗ Error importing question: ${error.message}`);
        skipped++;
      }
    }
    
    // Create AnalysisReport for this file
    if (promptIds.length > 0) {
      try {
        const totalQuestions = promptIds.length;
        
        // Calculate Bloom's distribution percentages
        const bloomDistribution = {
          Recall: Math.round((bloomCounts.remember / totalQuestions) * 100),
          Understand: Math.round((bloomCounts.understand / totalQuestions) * 100),
          Apply: Math.round((bloomCounts.apply / totalQuestions) * 100),
          Analyze: Math.round((bloomCounts.analyze / totalQuestions) * 100),
          Evaluate: Math.round((bloomCounts.evaluate / totalQuestions) * 100),
          Create: Math.round((bloomCounts.create / totalQuestions) * 100),
        };
        
        // Check if report already exists for this file
        const existingReport = await analysisReportRepo.findOne({
          originalFileName: filename,
          subjectName,
        });
        
        if (!existingReport) {
          await analysisReportRepo.create({
            examAnalysisId: `ocr-import-${Date.now()}-${filename}`,
            subjectName,
            year: 'Not available',
            semester: 'Not available',
            examType: 'main',
            questionIds: promptIds,
            totalQuestions,
            bloomDistribution,
            overallAssessment: `OCR imported question paper with ${totalQuestions} questions across various Bloom's taxonomy levels.`,
            originalFileName: filename,
            originalFileUrl: `/uploads/ocr/${filename}`,
            publishedBy: 'system-ocr-import',
            publishedAt: new Date(),
            tags: ['ocr-imported'],
            viewCount: 0,
            isPublic: true,
          });
          console.log(`  📄 Created AnalysisReport for ${filename}`);
        } else {
          console.log(`  ℹ AnalysisReport already exists for ${filename}`);
        }
      } catch (error: any) {
        console.error(`  ✗ Error creating AnalysisReport: ${error.message}`);
      }
    }
    
    console.log(`  ✓ ${filename}: ${imported} new, ${updated} tracked occurrences, ${skipped} duplicates`);
    return { imported, skipped, updated };
  } catch (error: any) {
    console.error(`  ✗ Error processing file ${path.basename(filePath)}:`, error.message);
    return { imported: 0, skipped: 0, updated: 0 };
  }
}

/**
 * Import questions from a subject directory
 */
async function importSubjectQuestions(subjectDir: string, subjectName: string): Promise<ImportResult> {
  console.log(`\n📂 Processing subject: ${subjectName}`);
  
  try {
    // Ensure subject exists in database
    await getOrCreateSubject(subjectName);
    
    // Read all files in subject directory
    const files = await fs.readdir(subjectDir);
    const txtFiles = files.filter(f => f.endsWith('.txt'));
    
    if (txtFiles.length === 0) {
      console.log(`  ℹ No .txt files found`);
      return { imported: 0, skipped: 0, updated: 0 };
    }
    
    let totalImported = 0;
    let totalSkipped = 0;
    let totalUpdated = 0;
    
    // Process each file
    for (const file of txtFiles) {
      const filePath = path.join(subjectDir, file);
      const result = await importQuestionsFromFile(filePath, subjectName);
      totalImported += result.imported;
      totalSkipped += result.skipped;
      totalUpdated += result.updated;
    }
    
    console.log(`✅ Subject complete: ${totalImported} new questions, ${totalUpdated} occurrence updates, ${totalSkipped} duplicates`);
    return { imported: totalImported, skipped: totalSkipped, updated: totalUpdated };
  } catch (error: any) {
    console.error(`✗ Error processing subject ${subjectName}:`, error.message);
    return { imported: 0, skipped: 0, updated: 0 };
  }
}

/**
 * Main import function
 */
async function importAllQuestions() {
  console.log('🚀 Starting OCR Questions Import...\n');
  console.log(`📁 Source directory: ${QUESTION_PAPERS_PATH}\n`);
  
  try {
    // Connect to database
    await connect();
    console.log('✓ Connected to database\n');
    
    // Read all subject directories
    const entries = await fs.readdir(QUESTION_PAPERS_PATH, { withFileTypes: true });
    const subjectDirs = entries.filter(entry => entry.isDirectory());
    
    console.log(`Found ${subjectDirs.length} subject directories\n`);
    
    let grandTotalImported = 0;
    let grandTotalSkipped = 0;
    let grandTotalUpdated = 0;
    let subjectsProcessed = 0;
    
    // Process each subject directory
    for (const subjectDir of subjectDirs) {
      const subjectName = subjectDir.name;
      const subjectPath = path.join(QUESTION_PAPERS_PATH, subjectName);
      
      const result = await importSubjectQuestions(subjectPath, subjectName);
      grandTotalImported += result.imported;
      grandTotalSkipped += result.skipped;
      grandTotalUpdated += result.updated;
      subjectsProcessed++;
    }
    
    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 IMPORT SUMMARY');
    console.log('='.repeat(60));
    console.log(`Subjects processed: ${subjectsProcessed}`);
    console.log(`New questions imported: ${grandTotalImported}`);
    console.log(`Occurrence updates (questions tracked): ${grandTotalUpdated}`);
    console.log(`Duplicate prompts skipped: ${grandTotalSkipped}`);
    console.log('='.repeat(60));
    console.log(`\n💡 Total unique questions tracked: ${grandTotalImported + grandTotalUpdated}`);
    
    process.exit(0);
  } catch (error: any) {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  }
}

// Run the import
importAllQuestions();

export { importAllQuestions };
