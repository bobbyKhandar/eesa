/**
 * DRY RUN script - Preview what would be imported from OCR files
 * Does not modify the database
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Base path for question papers
const QUESTION_PAPERS_PATH = path.join(__dirname, '../../../outputs/questionPapers');

// Map Bloom's levels
const BLOOM_LEVEL_MAP = {
  'Remember': 'remember',
  'Understand': 'understand',
  'Apply': 'apply',
  'Analyze': 'analyze',
  'Evaluate': 'evaluate',
  'Create': 'create'
};

function parseFilename(filename) {
  const parts = filename.replace('.txt', '').split('-');
  return {
    year: parts[0] || undefined,
    originalFileName: filename,
    metadata: parts.slice(1).join('-')
  };
}

function parseQuestions(content, subjectName, fileMetadata) {
  try {
    let cleanContent = content
      .trim()
      .replace(/\n/g, ' ')
      .replace(/undefined/g, 'null')
      // Convert JSON5 to JSON: wrap property names in double quotes
      .replace(/(\w+):/g, '"$1":')
      // Convert single quotes to double quotes
      .replace(/'/g, '"');
    
    const questions = JSON.parse(cleanContent);
    
    if (!Array.isArray(questions)) {
      return { valid: 0, invalid: 0, errors: ['Content is not an array'] };
    }
    
    const validQuestions = questions.filter(q => {
      return q && 
             q.question && 
             typeof q.question === 'string' && 
             q.question.trim() !== '' &&
             q.question !== 'null' &&
             q.question !== 'undefined';
    });
    
    const invalidCount = questions.length - validQuestions.length;
    
    // Count Bloom's levels
    const bloomCounts = {};
    validQuestions.forEach(q => {
      const level = q.level || 'Unknown';
      bloomCounts[level] = (bloomCounts[level] || 0) + 1;
    });
    
    return { 
      valid: validQuestions.length, 
      invalid: invalidCount,
      bloomDistribution: bloomCounts,
      errors: []
    };
  } catch (error) {
    return { valid: 0, invalid: 0, errors: [error.message] };
  }
}

async function analyzeFile(filePath, subjectName) {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const filename = path.basename(filePath);
    const fileMetadata = parseFilename(filename);
    
    const result = parseQuestions(content, subjectName, fileMetadata);
    
    return {
      filename,
      ...result,
      year: fileMetadata.year
    };
  } catch (error) {
    return {
      filename: path.basename(filePath),
      valid: 0,
      invalid: 0,
      errors: [error.message]
    };
  }
}

async function analyzeSubject(subjectDir, subjectName) {
  try {
    const files = await fs.readdir(subjectDir);
    const txtFiles = files.filter(f => f.endsWith('.txt'));
    
    if (txtFiles.length === 0) {
      return {
        subjectName,
        fileCount: 0,
        totalValid: 0,
        totalInvalid: 0,
        files: []
      };
    }
    
    const fileResults = [];
    let totalValid = 0;
    let totalInvalid = 0;
    
    for (const file of txtFiles) {
      const filePath = path.join(subjectDir, file);
      const result = await analyzeFile(filePath, subjectName);
      fileResults.push(result);
      totalValid += result.valid;
      totalInvalid += result.invalid;
    }
    
    return {
      subjectName,
      fileCount: txtFiles.length,
      totalValid,
      totalInvalid,
      files: fileResults
    };
  } catch (error) {
    return {
      subjectName,
      fileCount: 0,
      totalValid: 0,
      totalInvalid: 0,
      error: error.message
    };
  }
}

async function dryRun() {
  console.log('🔍 DRY RUN - OCR Questions Import Preview\n');
  console.log(`📁 Source directory: ${QUESTION_PAPERS_PATH}\n`);
  
  try {
    // Check if directory exists
    try {
      await fs.access(QUESTION_PAPERS_PATH);
    } catch {
      console.error(`❌ Directory not found: ${QUESTION_PAPERS_PATH}`);
      process.exit(1);
    }
    
    const entries = await fs.readdir(QUESTION_PAPERS_PATH, { withFileTypes: true });
    const subjectDirs = entries.filter(entry => entry.isDirectory());
    
    console.log(`Found ${subjectDirs.length} subject directories\n`);
    console.log('Analyzing files...\n');
    
    const results = [];
    let grandTotalValid = 0;
    let grandTotalInvalid = 0;
    let grandTotalFiles = 0;
    
    for (const subjectDir of subjectDirs) {
      const subjectName = subjectDir.name;
      const subjectPath = path.join(QUESTION_PAPERS_PATH, subjectName);
      
      const result = await analyzeSubject(subjectPath, subjectName);
      results.push(result);
      grandTotalValid += result.totalValid;
      grandTotalInvalid += result.totalInvalid;
      grandTotalFiles += result.fileCount;
      
      // Show progress
      if (result.totalValid > 0) {
        console.log(`✓ ${subjectName}: ${result.totalValid} questions in ${result.fileCount} file(s)`);
      }
    }
    
    // Print detailed summary
    console.log('\n' + '='.repeat(70));
    console.log('📊 IMPORT PREVIEW SUMMARY');
    console.log('='.repeat(70));
    console.log(`Total subjects: ${results.length}`);
    console.log(`Total files: ${grandTotalFiles}`);
    console.log(`Valid questions to import: ${grandTotalValid}`);
    console.log(`Invalid/skipped entries: ${grandTotalInvalid}`);
    console.log('='.repeat(70));
    
    // Show subjects with most questions
    console.log('\n📈 TOP 10 SUBJECTS BY QUESTION COUNT:');
    console.log('-'.repeat(70));
    const topSubjects = results
      .filter(r => r.totalValid > 0)
      .sort((a, b) => b.totalValid - a.totalValid)
      .slice(0, 10);
    
    topSubjects.forEach((subject, index) => {
      console.log(`${index + 1}. ${subject.subjectName}: ${subject.totalValid} questions`);
    });
    
    // Show subjects with issues
    const subjectsWithIssues = results.filter(r => r.totalInvalid > 0 || r.error);
    if (subjectsWithIssues.length > 0) {
      console.log('\n⚠️  SUBJECTS WITH ISSUES:');
      console.log('-'.repeat(70));
      subjectsWithIssues.slice(0, 10).forEach(subject => {
        if (subject.error) {
          console.log(`✗ ${subject.subjectName}: ${subject.error}`);
        } else {
          console.log(`⚠ ${subject.subjectName}: ${subject.totalInvalid} invalid entries`);
        }
      });
    }
    
    // Show sample file details
    console.log('\n📄 SAMPLE FILE DETAILS (First 5 files):');
    console.log('-'.repeat(70));
    let sampleCount = 0;
    for (const subject of results) {
      if (sampleCount >= 5) break;
      for (const file of subject.files) {
        if (sampleCount >= 5) break;
        console.log(`\n📂 ${subject.subjectName}/${file.filename}`);
        console.log(`   Year: ${file.year || 'Unknown'}`);
        console.log(`   Valid: ${file.valid}, Invalid: ${file.invalid}`);
        if (file.bloomDistribution) {
          console.log(`   Bloom's levels: ${Object.entries(file.bloomDistribution).map(([k,v]) => `${k}(${v})`).join(', ')}`);
        }
        if (file.errors && file.errors.length > 0) {
          console.log(`   Errors: ${file.errors.join(', ')}`);
        }
        sampleCount++;
      }
    }
    
    console.log('\n' + '='.repeat(70));
    console.log('✅ DRY RUN COMPLETE');
    console.log('='.repeat(70));
    console.log('\nTo perform actual import, run: npm run import-ocr\n');
    
  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  }
}

// Run the dry run
dryRun();

export { dryRun };
