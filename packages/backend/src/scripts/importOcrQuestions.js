/**
 * Script to import OCR questions from questionPapers directory into the database
 * 
 * Directory structure: outputs/questionPapers/{subjectName}/{year-metadata.txt}
 * Each txt file contains JSON5 array of questions with 'question' and 'level' properties
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { connect } from '../database/connect.js';
import { getPromptModel } from '../database/models.js';
import { getSubjectModel } from '../database/mongooseSchemas.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Map Bloom's levels from OCR format to database format
const BLOOM_LEVEL_MAP = {
  'Remember': 'remember',
  'Understand': 'understand',
  'Apply': 'apply',
  'Analyze': 'analyze',
  'Evaluate': 'evaluate',
  'Create': 'create'
};

// Base path for question papers
const QUESTION_PAPERS_PATH = path.join(__dirname, '../../../outputs/questionPapers');

/**
 * Parse filename to extract metadata
 * Format: year-metadata-branch-sem-etc-SubjectName.txt
 */
function parseFilename(filename) {
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
 * Handles undefined and null values
 */
function parseQuestions(content, subjectName, fileMetadata) {
  try {
    // Clean up the content - convert JSON5 to valid JSON
    let cleanContent = content
      .trim()
      .replace(/\n/g, ' ')
      .replace(/undefined/g, 'null')
      // Convert JSON5 to JSON: wrap property names in double quotes
      .replace(/(\w+):/g, '"$1":')
      // Convert single quotes to double quotes
      .replace(/'/g, '"');
    
    // Parse the JSON
    const questions = JSON.parse(cleanContent);
    
    if (!Array.isArray(questions)) {
      console.warn(`Content is not an array in file: ${fileMetadata.originalFileName}`);
      return [];
    }
    
    // Filter out null/undefined questions and validate
    const validQuestions = questions.filter(q => {
      return q && 
             q.question && 
             typeof q.question === 'string' && 
             q.question.trim() !== '' &&
             q.question !== 'null' &&
             q.question !== 'undefined';
    }).map(q => ({
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
  } catch (error) {
    console.error(`Error parsing questions from ${fileMetadata.originalFileName}:`, error.message);
    return [];
  }
}

/**
 * Get or create subject in database
 */
async function getOrCreateSubject(subjectName) {
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
      subjectSyllabus: '',
      analysisReportIds: []
    });
    console.log(`✓ Created subject: ${subjectName}`);
  }
  
  return subject;
}

/**
 * Import questions for a single file
 */
async function importQuestionsFromFile(filePath, subjectName) {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const filename = path.basename(filePath);
    const fileMetadata = parseFilename(filename);
    
    // Parse questions from file
    const questions = parseQuestions(content, subjectName, fileMetadata);
    
    if (questions.length === 0) {
      console.log(`  ⚠ No valid questions found in: ${filename}`);
      return { imported: 0, skipped: 0 };
    }
    
    // Get or create the Prompt model
    const PromptModel = getPromptModel();
    
    let imported = 0;
    let skipped = 0;
    
    // Import each question
    for (const questionData of questions) {
      try {
        // Check if question already exists (avoid duplicates)
        const existing = await PromptModel.findOne({
          questionText: questionData.questionText,
          subject: questionData.subject
        });
        
        if (existing) {
          skipped++;
          continue;
        }
        
        // Create the question
        await PromptModel.create(questionData);
        imported++;
      } catch (error) {
        console.error(`  ✗ Error importing question: ${error.message}`);
        skipped++;
      }
    }
    
    console.log(`  ✓ ${filename}: ${imported} imported, ${skipped} skipped`);
    return { imported, skipped };
  } catch (error) {
    console.error(`  ✗ Error processing file ${path.basename(filePath)}:`, error.message);
    return { imported: 0, skipped: 0 };
  }
}

/**
 * Import questions from a subject directory
 */
async function importSubjectQuestions(subjectDir, subjectName) {
  console.log(`\n📂 Processing subject: ${subjectName}`);
  
  try {
    // Ensure subject exists in database
    await getOrCreateSubject(subjectName);
    
    // Read all files in subject directory
    const files = await fs.readdir(subjectDir);
    const txtFiles = files.filter(f => f.endsWith('.txt'));
    
    if (txtFiles.length === 0) {
      console.log(`  ℹ No .txt files found`);
      return { imported: 0, skipped: 0 };
    }
    
    let totalImported = 0;
    let totalSkipped = 0;
    
    // Process each file
    for (const file of txtFiles) {
      const filePath = path.join(subjectDir, file);
      const result = await importQuestionsFromFile(filePath, subjectName);
      totalImported += result.imported;
      totalSkipped += result.skipped;
    }
    
    console.log(`✅ Subject complete: ${totalImported} questions imported, ${totalSkipped} skipped`);
    return { imported: totalImported, skipped: totalSkipped };
  } catch (error) {
    console.error(`✗ Error processing subject ${subjectName}:`, error.message);
    return { imported: 0, skipped: 0 };
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
    let subjectsProcessed = 0;
    
    // Process each subject directory
    for (const subjectDir of subjectDirs) {
      const subjectName = subjectDir.name;
      const subjectPath = path.join(QUESTION_PAPERS_PATH, subjectName);
      
      const result = await importSubjectQuestions(subjectPath, subjectName);
      grandTotalImported += result.imported;
      grandTotalSkipped += result.skipped;
      subjectsProcessed++;
    }
    
    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 IMPORT SUMMARY');
    console.log('='.repeat(60));
    console.log(`Subjects processed: ${subjectsProcessed}`);
    console.log(`Questions imported: ${grandTotalImported}`);
    console.log(`Questions skipped: ${grandTotalSkipped}`);
    console.log('='.repeat(60));
    
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  }
}

// Run the import
importAllQuestions();

export { importAllQuestions };
