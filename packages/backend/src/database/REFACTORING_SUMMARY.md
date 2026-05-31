# Database Refactoring Summary

## Overview

Refactored the monolithic `db.ts` file into a clean, class-based repository pattern for better maintainability and organization.

---

## New Structure

### Repository Classes

```
backend/src/database/repositories/
├── PromptRepository.ts          - Prompt (question library) operations
├── ExamQuestionRepository.ts    - ExamQuestion (exam instances) operations
├── ExamRepository.ts            - Exam management operations
├── ExamSubmissionRepository.ts  - Submission lifecycle operations
└── index.ts                     - Central export point
```

### Class Organization

#### 1. **PromptRepository** (9 methods)
Manages the central question library with different source types (OCR/LLM/User).

**Methods:**
- `create()` - Create single prompt
- `createBulk()` - Batch create prompts (OCR pipeline)
- `getById()` - Retrieve by ID
- `search()` - Advanced filtering by subject/topic/bloomsLevel
- `getLowConfidenceOcr()` - Quality control for OCR questions
- `update()` - Edit/correct prompts
- `getBySource()` - PYQ tracking
- `delete()` - Remove prompt
- `getCountBySource()` - Statistics by generation method

**Example Usage:**
```typescript
import { PromptRepository } from './repositories/PromptRepository.js';

const promptRepo = new PromptRepository();

// Create OCR prompt
const result = await promptRepo.create({
  questionText: "What is photosynthesis?",
  subject: "biology",
  topic: "Plant Biology",
  generateVia: 'ocr',
  ocrConfidence: 0.92,
  source: "biology_textbook_ch3.pdf",
  createdBy: "teacher_123",
  bloomsLevel: 'remember'
});

// Search prompts
const prompts = await promptRepo.search({
  subject: "mathematics",
  bloomsLevel: ['remember', 'understand'],
  minOcrConfidence: 0.85,
  limit: 20
});
```

---

#### 2. **ExamQuestionRepository** (6 methods)
Manages exam-specific question configurations.

**Methods:**
- `create()` - Create single exam question instance
- `createBulk()` - Batch create exam questions
- `getWithPrompt()` - Get with populated prompt details (2-level join)
- `getManyWithPrompts()` - Get multiple with prompts
- `getExamsUsingPrompt()` - Impact analysis
- `getById()` - Retrieve by ID
- `delete()` - Remove exam question

**Example Usage:**
```typescript
import { ExamQuestionRepository } from './repositories/ExamQuestionRepository.js';

const examQuestionRepo = new ExamQuestionRepository();

// Create exam-specific question
const result = await examQuestionRepo.create({
  promptId: "prompt_123",
  marks: 10,
  negativeMarks: 2.5,
  answerType: 'mcq',
  options: [
    { text: "Option A", isCorrect: true },
    { text: "Option B", isCorrect: false },
    { text: "Option C", isCorrect: false },
    { text: "Option D", isCorrect: false }
  ]
});

// Get with full prompt details
const questionWithPrompt = await examQuestionRepo.getWithPrompt(examQuestionId);
```

---

#### 3. **ExamRepository** (8 methods)
Manages complete exam lifecycle.

**Methods:**
- `createWithPrompts()` - Create exam with questions (multi-step transaction)
- `getWithFullDetails()` - 3-level join (Exam → ExamQuestion → Prompt)
- `assignToUsers()` - User assignment
- `getById()` - Retrieve by ID
- `getBySubject()` - Filter by subject
- `getByCreator()` - Filter by creator
- `update()` - Update exam details
- `delete()` - Remove exam

**Example Usage:**
```typescript
import { ExamRepository } from './repositories/ExamRepository.js';

const examRepo = new ExamRepository();

// Create complete exam
const result = await examRepo.createWithPrompts({
  examTitle: "Midterm Exam - Biology",
  examDescription: "Covers chapters 1-5",
  subject: "biology",
  examDegree: "Bachelor of Science",
  examType: "Midterm",
  passingPercentage: 40,
  duration: 120,
  createdBy: "teacher_123",
  assignedUsers: ["user_1", "user_2", "user_3"],
  questions: [
    {
      promptId: "prompt_123",
      marks: 10,
      negativeMarks: 2.5,
      answerType: 'mcq',
      options: [...]
    }
  ]
});

// Get full exam with all question details
const examData = await examRepo.getWithFullDetails(examId);
```

---

#### 4. **ExamSubmissionRepository** (8 methods)
Manages submission lifecycle and evaluation.

**Methods:**
- `start()` - Initialize submission (IN_PROGRESS)
- `updateProgress()` - Save answers during exam
- `finalize()` - Submit exam (SUBMITTED status)
- `evaluate()` - Grade and provide feedback (EVALUATED status)
- `getById()` - Retrieve by ID
- `getByExam()` - All submissions for an exam
- `getByUser()` - User's submission history
- `getByExamAndUser()` - Specific submission
- `delete()` - Remove submission

**Example Usage:**
```typescript
import { ExamSubmissionRepository } from './repositories/ExamSubmissionRepository.js';

const submissionRepo = new ExamSubmissionRepository();

// Start exam
const startResult = await submissionRepo.start(examId, userId);
const submissionId = startResult.submissionId;

// Auto-save progress
await submissionRepo.updateProgress(submissionId, {
  responses: [
    { examQuestionId: "eq1", response: "2", isCorrect: true },
    { examQuestionId: "eq2", response: "This is my answer" }
  ],
  timeSpent: 45
});

// Submit
await submissionRepo.finalize(submissionId, false);

// Evaluate
await submissionRepo.evaluate(submissionId, {
  totalScore: 85,
  responses: [
    { examQuestionId: "eq1", allottedMarks: 10, feedback: "Correct!" },
    { examQuestionId: "eq2", allottedMarks: 7, feedback: "Good, but missing key point" }
  ]
});
```

---

## Sample Data Generator

### Script: `generate-sample-data.js`

Generates realistic test data for all collections with different types:

**Features:**
- **OCR-sourced prompts** with varying confidence levels (0.78 - 0.95)
- **LLM-generated prompts** with complex, analytical questions
- **User-created prompts** with simple, direct questions
- **Complete exams** with 5-10 questions each
- **Exam submissions** in various states (IN_PROGRESS, SUBMITTED, EVALUATED)

**Usage:**
```bash
# Generate 50 items (default)
node generate-sample-data.js

# Clear existing data and generate 100 items
node generate-sample-data.js --clear --count=100
```

**Sample Data Distribution:**
- 30% OCR-sourced questions (with PDF source tracking)
- 30% LLM-generated questions (complex analytical)
- 40% User-created questions (simple/direct)
- Multiple exams per subject
- 3 submissions per exam (average)

**Generated Data Examples:**

**OCR Prompt (Low Confidence - Needs Review):**
```javascript
{
  questionText: "Define DNA replication",
  subject: "Biology",
  topic: "Genetics",
  generateVia: "ocr",
  source: "sample_paper_1.pdf",
  ocrConfidence: 0.78, // Below 0.85 threshold
  createdBy: "teacher_1",
  bloomsLevel: "understand"
}
```

**LLM Prompt (Analytical):**
```javascript
{
  questionText: "Analyze the impact of climate change on biodiversity in tropical rainforests.",
  subject: "Biology",
  topic: "Ecology",
  generateVia: "llm",
  createdBy: "teacher_1",
  bloomsLevel: "analyze"
}
```

**User Prompt (Simple):**
```javascript
{
  questionText: "What is photosynthesis?",
  subject: "Biology",
  topic: "Plant Biology",
  generateVia: "user",
  createdBy: "teacher_1",
  bloomsLevel: "remember"
}
```

---

## Benefits of Refactoring

### 1. **Maintainability**
- ✅ Each class has a single responsibility
- ✅ Methods grouped by domain logic
- ✅ Easy to locate and update specific functionality

### 2. **Testability**
- ✅ Can mock repositories easily for unit tests
- ✅ Each method can be tested independently
- ✅ Clear interfaces for testing

### 3. **Scalability**
- ✅ Add new methods to specific repository without touching others
- ✅ Easy to add new repositories (e.g., UserRepository, SubjectRepository)
- ✅ Can implement caching at repository level

### 4. **Type Safety**
- ✅ TypeScript classes provide better IntelliSense
- ✅ Method chaining and auto-completion
- ✅ Compile-time error detection

### 5. **Code Reusability**
- ✅ Singleton instances available via `repositories/index.ts`
- ✅ Can instantiate multiple instances if needed
- ✅ Shared helper methods within each class

---

## Migration from Old db.ts

### Option 1: Use Repositories Directly (Recommended)

**Before:**
```typescript
import { createPrompt, searchPrompts } from './database/db.js';

const result = await createPrompt({ ... });
const prompts = await searchPrompts({ subject: "math" });
```

**After:**
```typescript
import { PromptRepository } from './database/repositories/PromptRepository.js';

const promptRepo = new PromptRepository();
const result = await promptRepo.create({ ... });
const prompts = await promptRepo.search({ subject: "math" });
```

### Option 2: Use Singleton Instances

```typescript
import { promptRepo } from './database/repositories/index.js';

const result = await promptRepo.create({ ... });
const prompts = await promptRepo.search({ subject: "math" });
```

### Option 3: Keep db.ts as Facade (Backward Compatibility)

Update `db.ts` to use repositories internally:

```typescript
import { PromptRepository } from './repositories/PromptRepository.js';

const promptRepo = new PromptRepository();

export async function createPrompt(data) {
  return promptRepo.create(data);
}

export async function searchPrompts(filters) {
  return promptRepo.search(filters);
}
```

This maintains backward compatibility for existing code.

---

## Testing the Refactored Code

### 1. Generate Sample Data
```bash
cd backend/src/database/scripts
node generate-sample-data.js --count=50
```

### 2. Create Indexes
```bash
node create-indexes.js
```

### 3. Test Repository Methods
```typescript
import { promptRepo, examRepo } from './database/repositories/index.js';

// Test prompt creation
const result = await promptRepo.create({
  questionText: "Test question",
  subject: "math",
  generateVia: 'user',
  createdBy: "test_user"
});

console.log('Created prompt:', result.promptId);

// Test search
const prompts = await promptRepo.search({ subject: "math" });
console.log('Found prompts:', prompts.length);

// Test statistics
const counts = await promptRepo.getCountBySource();
console.log('Prompt counts:', counts);
// Output: { ocr: 15, llm: 15, user: 20 }
```

---

## File Size Comparison

| File | Before | After | Reduction |
|------|--------|-------|-----------|
| db.ts | ~1200 lines | ~200 lines (legacy functions) | 83% |
| PromptRepository.ts | - | ~250 lines | New |
| ExamQuestionRepository.ts | - | ~180 lines | New |
| ExamRepository.ts | - | ~220 lines | New |
| ExamSubmissionRepository.ts | - | ~200 lines | New |

**Total:** Same functionality, better organized across 4 focused classes.

---

## Next Steps

1. **Update API Routes** - Use repositories instead of direct db.ts functions
2. **Add Unit Tests** - Test each repository class independently
3. **Add Caching Layer** - Implement Redis caching at repository level
4. **Add Logging** - Replace console.log with proper logger
5. **Add Transactions** - Wrap multi-step operations in transactions
6. **Create More Repositories** - UserRepository, SubjectRepository, etc.

---

## Quick Reference

### Import Patterns

```typescript
// Single repository
import { PromptRepository } from './database/repositories/PromptRepository.js';
const promptRepo = new PromptRepository();

// Multiple repositories
import { 
  PromptRepository,
  ExamRepository,
  ExamSubmissionRepository 
} from './database/repositories/index.js';

// Singleton instances
import { promptRepo, examRepo, submissionRepo } from './database/repositories/index.js';
```

### Common Operations

```typescript
// Create prompt
const result = await promptRepo.create({ ... });

// Search prompts
const prompts = await promptRepo.search({ subject: "math" });

// Create exam with questions
const examResult = await examRepo.createWithPrompts({ ... });

// Get exam with full details
const exam = await examRepo.getWithFullDetails(examId);

// Start submission
const submission = await submissionRepo.start(examId, userId);

// Evaluate submission
await submissionRepo.evaluate(submissionId, { totalScore: 85, ... });
```

---

## Summary

✅ **Refactored** monolithic db.ts into 4 focused repository classes  
✅ **Created** sample data generator with OCR/LLM/User question types  
✅ **Maintained** all functionality with improved organization  
✅ **Added** new helper methods (getCountBySource, etc.)  
✅ **Improved** testability and maintainability  
✅ **Reduced** file size by 83% while keeping same features  

The codebase is now much more maintainable and scalable! 🎉
