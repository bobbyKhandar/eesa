# OCR Questions Import Scripts

This directory contains scripts to import OCR-processed question papers into the database.

## Overview

The scripts process question papers from the `outputs/questionPapers` directory and import them into MongoDB. Each question is stored in the `Prompt` collection with proper subject categorization.

## File Structure

```
outputs/questionPapers/
├── Subject Name 1/
│   ├── 2014-metadata-branch-sem.txt
│   └── 2015-metadata-branch-sem.txt
├── Subject Name 2/
│   └── 2013-metadata-branch-sem.txt
└── ...
```

Each `.txt` file contains a JSON5 array of questions:
```json5
[
  {question:'Question text here',level:'Understand'},
  {question:'Another question',level:'Apply'},
  ...
]
```

## Scripts

### 1. Dry Run (Preview)
**File:** `dryRunOcrImport.js`

Preview what would be imported without modifying the database.

```bash
npm run import-ocr:dry-run
```

**Output:**
- Total subjects and files found
- Valid vs invalid question counts
- Top subjects by question count
- Subjects with parsing issues
- Sample file details

### 2. Full Import
**File:** `importOcrQuestions.js`

Import all questions into the database.

```bash
npm run import-ocr
```

**Features:**
- Creates subjects automatically if they don't exist
- Skips duplicate questions (same text + subject)
- Maps Bloom's taxonomy levels to database format
- Handles malformed JSON gracefully
- Shows progress and summary

## Data Mapping

### Bloom's Taxonomy Levels
```
Remember   → remember
Understand → understand
Apply      → apply
Analyze    → analyze
Evaluate   → evaluate
Create     → create
```

### Question Document Structure
```javascript
{
  questionText: string,
  bloomsLevel: string,
  subject: string,
  source: string,           // Original filename
  generateVia: 'ocr',
  year: string,            // Extracted from filename
  metadata: string,        // Additional metadata from filename
  createdBy: 'system-ocr-import'
}
```

### Subject Document Structure
```javascript
{
  subjectName: string,
  subjectDescription: string,
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
}
```

## Error Handling

The scripts handle various error conditions:

1. **Missing files/directories** - Logged and skipped
2. **Malformed JSON** - Logged with error details
3. **Invalid questions** - Filtered out (null, undefined, empty)
4. **Duplicate questions** - Skipped automatically
5. **Database errors** - Logged per question

## Statistics (From Last Dry Run)

- **Total Subjects:** 1,280
- **Total Files:** 4,703
- **Valid Questions:** 82,662
- **Invalid Entries:** ~47

### Top Subjects by Question Count
1. Wireless Communication: 344 questions
2. Control Systems: 332 questions
3. Computer Network: 329 questions
4. Digital Electronics: 290 questions
5. Database Management Systems: 280 questions
6. Data Structures: 271 questions
7. Operating System: 265 questions
8. Microprocessor and Microcontrollers: 239 questions
9. Power Electronics and Drives: 238 questions
10. Project Management: 238 questions

## Important Notes

1. **Database Connection** - Ensure MongoDB is running and `.env` is configured
2. **Duplicates** - Questions are checked by `questionText` + `subject`
3. **File Format** - Files must be `.txt` with JSON5 array format
4. **Performance** - Import may take several minutes for ~83k questions
5. **Idempotent** - Safe to run multiple times (skips existing questions)

## Troubleshooting

### Import fails with "Connection timeout"
- Check MongoDB is running
- Verify `.env` has correct `MONGODB_URI`

### No questions imported
- Run dry-run first to see parsing errors
- Check file format matches expected JSON5 structure

### Some questions skipped
- Normal - duplicates are skipped
- Run with dry-run to see invalid entries

## Example Usage

```bash
# Step 1: Preview what will be imported
npm run import-ocr:dry-run

# Step 2: Review the output, check for errors

# Step 3: Run actual import
npm run import-ocr

# Output example:
# 🚀 Starting OCR Questions Import...
# ✓ Connected to database
# 
# 📂 Processing subject: Advanced Databases
#   ✓ 2014-file.txt: 15 imported, 0 skipped
#   ✓ 2015-file.txt: 12 imported, 3 skipped
# ✅ Subject complete: 27 questions imported, 3 skipped
# ...
# 
# ═══════════════════════════════════════
# 📊 IMPORT SUMMARY
# ═══════════════════════════════════════
# Subjects processed: 1,280
# Questions imported: 82,662
# Questions skipped: 0
# ═══════════════════════════════════════
```

## Future Enhancements

- [ ] Add progress bar for long imports
- [ ] Support for batch processing
- [ ] Generate import report in HTML/PDF
- [ ] Add command-line arguments for filtering
- [ ] Support for incremental imports (only new files)
- [ ] Integration with unique questions deduplication
