# Quick Reference Guide - New Schema Architecture

## Table of Contents
1. [Schema Overview](#schema-overview)
2. [Common Operations](#common-operations)
3. [API Usage Examples](#api-usage-examples)
4. [Error Handling](#error-handling)
5. [Performance Tips](#performance-tips)

---

## Schema Overview

### Data Flow
```
Prompt (Central Library)
   ↓ promptId
ExamQuestion (Instance Config)
   ↓ questions array
Exam (Metadata + Assignments)
   ↓ examId
ExamSubmission (User Attempt)
```

### Collections
- **Prompts** - Immutable question library (OCR/LLM/User created)
- **ExamQuestions** - Exam-specific configurations (marks, options)
- **Exams** - Exam metadata with assigned users
- **ExamSubmissions** - Student attempts with responses
- **Users** - Students/Teachers with assignments

---

## Common Operations

### 1. Creating Questions (OCR/Manual)

```typescript
// Single question
import { createPrompt } from './database/db.js';

const result = await createPrompt({
  questionText: "What is the capital of France?",
  subject: subjectId,
  topic: "Geography",
  generateVia: 'user', // or 'ocr' | 'llm'
  createdBy: teacherId,
  bloomsLevel: 'remember'
});

if (result.success) {
  console.log('Prompt created:', result.promptId);
}

// Batch import (OCR pipeline)
import { createPromptsBulk } from './database/db.js';

const promptsData = [
  { questionText: "Q1...", subject: "math", generateVia: 'ocr', ... },
  { questionText: "Q2...", subject: "math", generateVia: 'ocr', ... }
];

const result = await createPromptsBulk(promptsData);
// result.promptIds: ["id1", "id2", ...]
```

### 2. Searching Question Library

```typescript
import { searchPrompts } from './database/db.js';

// Basic search
const prompts = await searchPrompts({
  subject: "mathematics",
  topic: "algebra"
});

// Advanced filters
const prompts = await searchPrompts({
  subject: "physics",
  bloomsLevel: ['remember', 'understand'], // Multiple levels
  generateVia: 'ocr',
  minOcrConfidence: 0.85, // Only high-confidence OCR
  limit: 20,
  skip: 0 // Pagination
});
```

### 3. Creating Exams

```typescript
import { createExamWithPrompts } from './database/db.js';

const result = await createExamWithPrompts({
  examTitle: "Midterm Exam - Mathematics",
  examDescription: "Covers chapters 1-5",
  subject: subjectId,
  examDegree: "Bachelor of Science",
  examType: "Midterm",
  passingPercentage: 40,
  duration: 120, // minutes
  scheduledAt: new Date('2024-03-15T10:00:00Z'),
  createdBy: teacherId,
  instructions: "Read all questions carefully...",
  negativeMarking: true,
  negativeMarkingPercentage: 25, // 25% of question marks
  assignedUsers: [userId1, userId2, userId3],
  questions: [
    {
      promptId: "prompt_id_1",
      marks: 5,
      negativeMarks: 1.25, // 25% of 5
      answerType: 'mcq',
      options: [
        { text: "Option A", isCorrect: false },
        { text: "Option B", isCorrect: true },
        { text: "Option C", isCorrect: false },
        { text: "Option D", isCorrect: false }
      ]
    },
    {
      promptId: "prompt_id_2",
      marks: 10,
      answerType: 'short',
      // No options for short answer
    }
  ]
});

if (result.success) {
  console.log('Exam created:', result.examId);
}
```

### 4. Fetching Exam for Student

```typescript
import { getExamWithFullDetails } from './database/db.js';

// This performs a 3-level join: Exam → ExamQuestion → Prompt
const examData = await getExamWithFullDetails(examId);

// Response structure:
{
  _id: "exam_id",
  examTitle: "Midterm Exam",
  examDescription: "...",
  duration: 120,
  questionDetails: [
    {
      _id: "exam_question_id",
      marks: 5,
      negativeMarks: 1.25,
      answerType: 'mcq',
      options: [...],
      promptData: {
        _id: "prompt_id",
        questionText: "What is...",
        subject: "math",
        topic: "algebra",
        bloomsLevel: "remember"
      }
    },
    // ... more questions
  ]
}
```

### 5. Exam Submission Flow

```typescript
import { 
  startExamSubmission,
  updateExamSubmission,
  finalizeExamSubmission,
  evaluateExamSubmission
} from './database/db.js';

// Step 1: Start exam (when student opens exam page)
const startResult = await startExamSubmission(examId, userId);
const submissionId = startResult.submissionId;

// Step 2: Save answers (auto-save every 30 seconds)
await updateExamSubmission(submissionId, {
  responses: [
    {
      examQuestionId: "eq1",
      response: "2", // Option index for MCQ or string for text
      isCorrect: undefined // Will be evaluated later
    },
    {
      examQuestionId: "eq2",
      response: [0, 2], // Multiple correct options
      isCorrect: undefined
    }
  ],
  timeSpent: 15 // minutes
});

// Step 3: Submit exam (when student clicks submit or timeout)
await finalizeExamSubmission(submissionId, false); // false = not auto-submitted

// Step 4: Evaluate (auto for MCQ, manual/LLM for subjective)
await evaluateExamSubmission(submissionId, {
  totalScore: 75,
  responses: [
    {
      examQuestionId: "eq1",
      allottedMarks: 5,
      feedback: "Correct answer"
    },
    {
      examQuestionId: "eq2",
      allottedMarks: 7,
      feedback: "Partially correct, missing key point about..."
    }
  ]
});
```

---

## API Usage Examples

### Teacher: Review Low Confidence OCR Questions

```typescript
import { getLowConfidenceOcrPrompts, updatePrompt } from './database/db.js';

// Fetch questions needing review
const lowConfidencePrompts = await getLowConfidenceOcrPrompts(0.85, 20);

for (const prompt of lowConfidencePrompts) {
  console.log(`Question: ${prompt.questionText}`);
  console.log(`Confidence: ${prompt.ocrConfidence}`);
  console.log(`Source: ${prompt.source}`);
  
  // Teacher reviews and corrects
  const correctedText = await teacherReview(prompt);
  
  // Update prompt
  await updatePrompt(prompt._id, {
    questionText: correctedText,
    ocrConfidence: 1.0 // Mark as verified
  });
}
```

### Student: Dashboard with Assigned Exams

```typescript
import { getUserModel } from './database/mongooseSchemas.js';
import { getExamModel } from './database/mongooseSchemas.js';

// Fetch user with populated exams
const user = await getUserModel()
  .findById(userId)
  .populate('currentAllocatedExams')
  .lean();

const assignedExams = user.currentAllocatedExams.map(exam => ({
  id: exam._id,
  title: exam.examTitle,
  subject: exam.subject,
  scheduledAt: exam.scheduledAt,
  duration: exam.duration,
  maxMarks: exam.examMaxMarks
}));

console.log('Assigned exams:', assignedExams);
```

### Admin: Analytics - Most Used Questions

```typescript
import { getExamQuestionModel } from './database/mongooseSchemas.js';

const popularPrompts = await getExamQuestionModel().aggregate([
  {
    $group: {
      _id: '$promptId',
      usageCount: { $sum: 1 }
    }
  },
  { $sort: { usageCount: -1 } },
  { $limit: 10 },
  {
    $lookup: {
      from: 'prompts',
      localField: '_id',
      foreignField: '_id',
      as: 'promptDetails'
    }
  },
  { $unwind: '$promptDetails' }
]);

popularPrompts.forEach((item, index) => {
  console.log(`${index + 1}. ${item.promptDetails.questionText}`);
  console.log(`   Used in ${item.usageCount} exams`);
});
```

---

## Error Handling

### Validation Errors

```typescript
import { createPrompt } from './database/db.js';

const result = await createPrompt({
  questionText: "", // Invalid: empty string
  subject: "math",
  generateVia: 'ocr',
  createdBy: "teacher123"
});

if (!result.success) {
  console.error('Validation error:', result.error);
  // Output: "Validation failed: questionText must not be empty"
}
```

### Duplicate Submission Prevention

```typescript
import { startExamSubmission } from './database/db.js';

const result = await startExamSubmission(examId, userId);

if (!result.success) {
  if (result.error.includes('already exists')) {
    // Submission exists, resume instead
    const submissionId = result.submissionId;
    console.log('Resuming existing submission:', submissionId);
  } else {
    console.error('Error:', result.error);
  }
}
```

### Handling Missing Data

```typescript
import { getExamWithFullDetails } from './database/db.js';

const examData = await getExamWithFullDetails(examId);

if (!examData) {
  return res.status(404).json({ error: 'Exam not found' });
}

if (!examData.questionDetails || examData.questionDetails.length === 0) {
  return res.status(400).json({ error: 'Exam has no questions' });
}
```

---

## Performance Tips

### 1. Use Aggregation Pipelines for Complex Queries

```typescript
// ✅ GOOD: Single aggregation query
const examData = await getExamWithFullDetails(examId);

// ❌ BAD: Multiple sequential queries
const exam = await getExamModel().findById(examId);
const examQuestions = await getExamQuestionModel().find({ _id: { $in: exam.questions } });
const prompts = await getPromptModel().find({ _id: { $in: examQuestions.map(eq => eq.promptId) } });
// This makes 3 round trips to DB instead of 1
```

### 2. Cache Frequently Accessed Data

```typescript
import Redis from 'ioredis';
const redis = new Redis();

async function getCachedExamDetails(examId) {
  const cacheKey = `exam:${examId}:full`;
  
  // Try cache first
  const cached = await redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }
  
  // Cache miss: fetch from DB
  const examData = await getExamWithFullDetails(examId);
  
  // Cache for 1 hour
  await redis.setex(cacheKey, 3600, JSON.stringify(examData));
  
  return examData;
}
```

### 3. Use Projection to Fetch Only Needed Fields

```typescript
import { getPromptModel } from './database/mongooseSchemas.js';

// ✅ GOOD: Only fetch necessary fields
const prompts = await getPromptModel()
  .find({ subject: "math" })
  .select('questionText subject topic bloomsLevel')
  .lean(); // Use lean() for read-only data (faster)

// ❌ BAD: Fetch entire document including large fields
const prompts = await getPromptModel().find({ subject: "math" });
```

### 4. Batch Operations

```typescript
// ✅ GOOD: Bulk insert
const result = await createPromptsBulk(promptsArray);

// ❌ BAD: Individual inserts in loop
for (const promptData of promptsArray) {
  await createPrompt(promptData); // N round trips to DB
}
```

### 5. Create Indexes (Run Once After Deployment)

```bash
# Run the index creation script
node backend/src/database/scripts/create-indexes.js
```

### 6. Monitor Slow Queries

```typescript
// Enable MongoDB profiling
db.setProfilingLevel(1, { slowms: 500 }); // Log queries >500ms

// Check slow queries
db.system.profile.find({ millis: { $gt: 500 } }).sort({ ts: -1 }).limit(10);
```

---

## Migration Checklist

- [ ] Run `create-indexes.js` to create database indexes
- [ ] Run `migrate-schema.js --dry-run` to preview migration
- [ ] Run `migrate-schema.js` to perform actual migration
- [ ] Verify data integrity with test queries
- [ ] Update API routes to use new database operations
- [ ] Update frontend to use new API endpoints
- [ ] Test submission flow end-to-end
- [ ] Set up monitoring for slow queries (>500ms)
- [ ] Configure Redis caching for exam details
- [ ] Schedule cleanup of old schema (after 2-3 releases)

---

## Troubleshooting

### "Validation failed" Errors
- Check that all required fields are provided
- Ensure `generateVia` is one of: 'llm', 'ocr', 'user'
- Verify `bloomsLevel` is valid if provided

### "Submission already exists" Error
- This is expected behavior to prevent duplicates
- Use the returned `submissionId` to resume the existing submission
- Don't create a new submission

### Slow Exam Loading
- Ensure indexes are created (run `create-indexes.js`)
- Enable caching for `getExamWithFullDetails()`
- Check MongoDB slow query log

### Missing Question Details
- Verify that ExamQuestion has valid `promptId`
- Check that Prompt exists in database
- Use aggregation pipeline debugging: `$match` → `$lookup` → `$unwind`

---

## Support

For questions or issues:
1. Check `DATABASE_QUERIES_ANALYSIS.md` for query patterns
2. Review `SCHEMA_IMPLEMENTATION_SUMMARY.md` for architecture details
3. Run migration script in `--dry-run` mode first
4. Enable MongoDB profiling to debug slow queries
