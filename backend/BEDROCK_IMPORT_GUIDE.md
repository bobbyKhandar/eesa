# Bedrock Enriched Questions Import Guide

## Overview
This guide explains how to import AWS Bedrock-processed and Bloom's taxonomy-enriched question papers into MongoDB.

## Schema Updates

### 1. **Prompt Schema** (`promptSchemaZod.ts`)
Updated to include Bloom's taxonomy fields:
- `bloomLevel`: Recall, Understand, Apply, Analyze, Evaluate, Create
- `bloomJustification`: Detailed explanation
- `confidence`: 0.0-1.0 confidence score
- `difficulty`: Easy, Medium, Hard
- `keywords`: Array of 3-5 key terms
- `topicsCovered`: Array of 2-4 main topics
- `questionType`: text, mcq, Short, Long, Numerical, Diagram
- `options`: Array for MCQ options
- `marks`: Mark allocation as string
- `subjectCode`, `branch`: Additional metadata

**Note**: `question_number` is **NOT** stored in the database (excluded by design).

### 2. **UniqueQuestion Schema** (`uniqueQuestionZod.ts`)
Enhanced with:
- All Bloom's taxonomy fields from Prompt
- Backward compatibility with old `bloomsLevel` (lowercase)
- New fields: `questionType`, `options`, `marks`, `keywords`, `topicsCovered`

### 3. **AnalysisReport Schema** (`analysisReportZod.ts`)
Added:
- `institutionName`: College/university name
- `maxMarks`: Total exam marks
- `source`: 'gemini', 'bedrock', or 'manual'
- `isVerified`, `isActive`: Status flags
- Made `examAnalysisId` and `originalFileUrl` optional for Bedrock imports

## Import Process

### Step 1: Run Bedrock Enrichment
```bash
# Process OCR text files
python ai_pipeline/src/awsBedrockPipeline.py

# Enrich with Bloom's taxonomy
python ai_pipeline/src/awsBedrockPipeline.py enrich
```

This creates `*_enriched.json` files in `ai_pipeline/enrichedQuestions/`

### Step 2: Import to MongoDB
```bash
cd backend
npm run build
node dist/scripts/importBedrockQuestions.js [directory]
```

**Default directory**: `C:/project/miniproject/ai_pipeline/enrichedQuestions`

### Step 3: Verify Import
Check MongoDB collections:
- **Prompt**: Individual questions with Bloom's data
- **UniqueQuestion**: Deduplicated questions with occurrence tracking
- **AnalysisReport**: Exam-level reports with Bloom's distribution
- **Subject**: Auto-created subjects linked to reports

## JSON Structure

### Input Format (Enriched JSON)
```json
{
  "exams": [{
    "subject": "Advanced Finite Element Analysis",
    "subjectCode": "PCCE201",
    "branch": "Mechanical (CCR)",
    "year": "2017",
    "semester": "II",
    "examType": "main",
    "max_marks": "100",
    "institutionName": "K.J. Somaiya College",
    "questions": [{
      "question_text": "Derive the shape functions...",
      "marks": "12",
      "questionType": "text",
      "options": null,
      "bloomLevel": "Create",
      "bloomJustification": "Deriving shape functions involves...",
      "confidence": 0.95,
      "difficulty": "Hard",
      "keywords": ["shape functions", "8-node", "element"],
      "topicsCovered": ["Finite Element Formulation", "Isoparametric Mapping"]
    }]
  }],
  "subjectsCreated": ["Advanced Finite Element Analysis"]
}
```

**Note**: `question_number` field is present in JSON but **excluded from database storage**.

## Database Collections

### Prompt Collection
```javascript
{
  questionText: "Derive the shape functions for an 8-node...",
  subject: "Advanced Finite Element Analysis",
  subjectCode: "PCCE201",
  branch: "Mechanical (CCR)",
  questionType: "text",
  marks: "12",
  bloomLevel: "Create",
  bloomJustification: "Deriving shape functions...",
  confidence: 0.95,
  difficulty: "Hard",
  keywords: ["shape functions", "8-node", "element"],
  topicsCovered: ["Finite Element Formulation"],
  generateVia: "bedrock",
  source: "PCCE201_enriched.json",
  createdAt: ISODate("2025-11-07...")
}
```

### UniqueQuestion Collection
```javascript
{
  questionText: "Derive the shape functions...",
  normalizedText: "derive shape functions 8node...",
  subject: "Advanced Finite Element Analysis",
  bloomLevel: "Create",
  occurrenceCount: 1,
  appearances: [{
    year: "2017",
    semester: "II",
    examType: "main",
    analysisReportId: "..."
  }],
  promptIds: ["..."],
  sourceReports: ["..."]
}
```

### AnalysisReport Collection
```javascript
{
  subjectName: "Advanced Finite Element Analysis",
  subjectCode: "PCCE201",
  year: "2017",
  semester: "II",
  examType: "main",
  maxMarks: "100",
  questionIds: ["...", "..."],
  totalQuestions: 13,
  bloomDistribution: {
    Recall: 0,
    Understand: 15.4,
    Apply: 69.2,
    Analyze: 0,
    Evaluate: 0,
    Create: 15.4
  },
  source: "bedrock",
  originalFileName: "PCCE201_enriched.json",
  isPublic: true,
  isActive: true
}
```

## Features

### Automatic Subject Creation
- Creates new subjects if they don't exist
- Links AnalysisReports to existing subjects
- Uses `subjectName` for matching

### Deduplication
- Uses `normalizedText` to detect duplicate questions
- Tracks occurrence count across different exams
- Records all appearances (year, semester, exam type)

### Bloom's Distribution
- Calculates percentages based on mark allocation
- Stored at AnalysisReport level
- Enables filtering by cognitive level

## Backward Compatibility

### Legacy Field Mapping
- `bloomsLevel` (old) ↔ `bloomLevel` (new)
- `difficulty` (old: lowercase) ↔ `difficulty` (new: Title Case)
- Both formats supported for smooth migration

## Running the Import

```bash
# Full workflow
cd ai_pipeline/src

# 1. Process OCR text
python awsBedrockPipeline.py

# 2. Enrich with Bloom's
python awsBedrockPipeline.py enrich

# 3. Import to MongoDB
cd ../../backend
npm run build
node dist/scripts/importBedrockQuestions.js

# Check logs for:
# - ✓ Successful imports
# - ✗ Failed imports
# - 📝 Total prompts created
# - 📊 Total reports created
```

## Troubleshooting

### Issue: "mongodb_url not found"
**Solution**: Ensure `.env` file has `mongodb_url` set

### Issue: Schema validation errors
**Solution**: Run `npm run build` to recompile TypeScript schemas

### Issue: Duplicate key errors
**Solution**: Questions are deduplicated automatically. Check if `analysisReportIds` already exists.

### Issue: Missing Bloom's data
**Solution**: Ensure enrichment step completed successfully. Check `enrichedQuestions/*.json` files.

## Next Steps

After import:
1. Verify data in MongoDB Compass
2. Test frontend subject pages
3. Check Bloom's distribution charts
4. Validate question deduplication

## API Endpoints (Future)

```typescript
GET /api/subjects/:subjectName/reports
GET /api/reports/:reportId/questions
GET /api/questions/unique?subject=...&bloomLevel=...
GET /api/questions/:questionId/occurrences
```
