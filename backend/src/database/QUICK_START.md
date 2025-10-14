# Quick Start Guide - 5 Minutes

Get started with the new repository pattern in 5 minutes.

---

## 1. Generate Sample Data (30 seconds)

```bash
cd backend/src/database/scripts
node generate-sample-data.js --count=50
```

✅ Creates 50 prompts, 10 exams, 30 submissions

---

## 2. Import & Use (1 minute)

### Old Way ❌
```typescript
import { createPrompt, searchPrompts } from './database/db.js';

const prompt = await createPrompt({ ... });
const results = await searchPrompts({ subject: "Math" });
```

### New Way ✅
```typescript
import { promptRepo } from './database/repositories/index.js';

const prompt = await promptRepo.create({ ... });
const results = await promptRepo.search({ subject: "Math" });
```

---

## 3. Common Operations (2 minutes)

### Create a Prompt
```typescript
import { promptRepo } from './database/repositories/index.js';

const result = await promptRepo.create({
  questionText: "What is React?",
  subject: "Web Development",
  topic: "Frontend Frameworks",
  generateVia: 'user',
  createdBy: "teacher_123",
  bloomsLevel: 'understand'
});

console.log('Created:', result.promptId);
```

### Search Prompts
```typescript
const prompts = await promptRepo.search({
  subject: "Mathematics",
  bloomsLevel: ['remember', 'understand'],
  limit: 20
});

console.log(`Found ${prompts.length} prompts`);
```

### Create an Exam
```typescript
import { examRepo } from './database/repositories/index.js';

const result = await examRepo.createWithPrompts({
  examTitle: "Midterm Exam",
  subject: "Computer Science",
  duration: 120,
  scheduledAt: new Date('2024-03-15T10:00:00Z'),
  createdBy: "teacher_123",
  assignedUsers: ["student_1", "student_2"],
  questions: [
    {
      promptId: "prompt_123",
      marks: 10,
      negativeMarks: 2.5,
      answerType: 'mcq',
      options: [
        { text: "Option A", isCorrect: true },
        { text: "Option B", isCorrect: false }
      ]
    }
  ]
});

console.log('Exam created:', result.examId);
```

### Get Exam Details (3-level join)
```typescript
const exam = await examRepo.getWithFullDetails(examId);

console.log(exam.examTitle);
console.log(`Questions: ${exam.questions.length}`);

exam.questions.forEach(q => {
  console.log(`- ${q.prompt.questionText} (${q.marks} marks)`);
});
```

### Start & Submit Exam
```typescript
import { submissionRepo } from './database/repositories/index.js';

// Student opens exam
const start = await submissionRepo.start(examId, userId);
const submissionId = start.submissionId;

// Auto-save progress
await submissionRepo.updateProgress(submissionId, {
  responses: [
    { examQuestionId: "eq1", selectedOptions: ["option_1"] }
  ],
  timeSpent: 15
});

// Submit
await submissionRepo.finalize(submissionId, false);

// Grade
await submissionRepo.evaluate(submissionId, {
  totalScore: 85,
  responses: [
    { examQuestionId: "eq1", allottedMarks: 10 }
  ]
});
```

---

## 4. Available Repositories (1 minute)

### PromptRepository (9 methods)
```typescript
import { promptRepo } from './database/repositories/index.js';

promptRepo.create(data)              // Create single
promptRepo.createBulk(data[])        // Batch create (OCR)
promptRepo.getById(id)               // Get by ID
promptRepo.search(filters)           // Advanced search
promptRepo.getLowConfidenceOcr()     // Quality control
promptRepo.update(id, updates)       // Edit
promptRepo.getBySource(source)       // PYQ tracking
promptRepo.delete(id)                // Remove
promptRepo.getCountBySource()        // Statistics
```

### ExamQuestionRepository (6 methods)
```typescript
import { examQuestionRepo } from './database/repositories/index.js';

examQuestionRepo.create(data)
examQuestionRepo.createBulk(data[])
examQuestionRepo.getWithPrompt(id)           // 2-level join
examQuestionRepo.getManyWithPrompts(ids[])
examQuestionRepo.getExamsUsingPrompt(promptId)  // Impact analysis
examQuestionRepo.delete(id)
```

### ExamRepository (8 methods)
```typescript
import { examRepo } from './database/repositories/index.js';

examRepo.createWithPrompts(data)     // Multi-step
examRepo.getWithFullDetails(id)      // 3-level join
examRepo.assignToUsers(id, userIds[])
examRepo.getById(id)
examRepo.getBySubject(subjectId)
examRepo.getByCreator(creatorId)
examRepo.update(id, updates)
examRepo.delete(id)
```

### ExamSubmissionRepository (8 methods)
```typescript
import { submissionRepo } from './database/repositories/index.js';

submissionRepo.start(examId, userId)         // IN_PROGRESS
submissionRepo.updateProgress(id, data)      // Auto-save
submissionRepo.finalize(id, autoSubmit)      // SUBMITTED
submissionRepo.evaluate(id, evaluation)      // EVALUATED
submissionRepo.getById(id)
submissionRepo.getByExam(examId)
submissionRepo.getByUser(userId)
submissionRepo.getByExamAndUser(examId, userId)
```

---

## 5. Error Handling (30 seconds)

All repository methods return:
```typescript
{ success: true, data: {...} }  // Success
{ success: false, error: "..." } // Failure
```

Example:
```typescript
const result = await promptRepo.create(data);

if (!result.success) {
  console.error('Error:', result.error);
  return res.status(400).json({ error: result.error });
}

return res.json({ promptId: result.promptId });
```

---

## 6. Complete Example: API Route (1 minute)

**Before:**
```typescript
import { searchPrompts, createPrompt } from '../database/db.js';

router.get('/search', async (req, res) => {
  const prompts = await searchPrompts(req.query);
  res.json(prompts);
});

router.post('/', async (req, res) => {
  const result = await createPrompt(req.body);
  res.json(result);
});
```

**After:**
```typescript
import { promptRepo } from '../database/repositories/index.js';

router.get('/search', async (req, res) => {
  const prompts = await promptRepo.search(req.query);
  res.json(prompts);
});

router.post('/', async (req, res) => {
  const result = await promptRepo.create(req.body);
  
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }
  
  res.json({ promptId: result.promptId });
});
```

---

## 7. IntelliSense Magic

Type `promptRepo.` and see:

```typescript
promptRepo.
  ├─ create()
  ├─ createBulk()
  ├─ getById()
  ├─ search()
  ├─ getLowConfidenceOcr()
  ├─ update()
  ├─ getBySource()
  ├─ delete()
  └─ getCountBySource()
```

Only 9 methods! (vs 31 in old db.ts)

---

## 8. Testing (30 seconds)

Create `test.js`:
```javascript
import { promptRepo, examRepo } from './database/repositories/index.js';

async function test() {
  // Search
  const prompts = await promptRepo.search({ subject: "Math", limit: 5 });
  console.log('✅ Found prompts:', prompts.length);

  // Get exam
  const exams = await examRepo.getBySubject("Mathematics");
  console.log('✅ Found exams:', exams.length);
  
  if (exams.length > 0) {
    const exam = await examRepo.getWithFullDetails(exams[0]._id);
    console.log('✅ Exam:', exam.examTitle);
    console.log('✅ Questions:', exam.questions.length);
  }
}

test();
```

Run: `node test.js`

---

## 9. Useful Workflows

### OCR Pipeline
```typescript
// 1. Extract text from PDF
const ocrResults = await extractTextFromPdf(pdfPath);

// 2. Bulk create prompts
const promptsData = ocrResults.map(r => ({
  questionText: r.text,
  subject: "Physics",
  generateVia: 'ocr',
  source: r.filename,
  ocrConfidence: r.confidence,
  createdBy: "ocr_system"
}));

const result = await promptRepo.createBulk(promptsData);

// 3. Review low confidence
const needReview = await promptRepo.getLowConfidenceOcr(0.85, 20);
needReview.forEach(p => {
  console.log(`Review: ${p.questionText} (${p.ocrConfidence})`);
});
```

### Create & Take Exam
```typescript
// 1. Teacher creates exam
const exam = await examRepo.createWithPrompts({
  examTitle: "Final Exam",
  subject: "Math",
  duration: 180,
  assignedUsers: ["student_1", "student_2"],
  questions: [...]
});

// 2. Student starts
const submission = await submissionRepo.start(exam.examId, "student_1");

// 3. Student answers
await submissionRepo.updateProgress(submission.submissionId, {
  responses: [...]
});

// 4. Student submits
await submissionRepo.finalize(submission.submissionId, false);

// 5. System grades
await submissionRepo.evaluate(submission.submissionId, {
  totalScore: 85,
  responses: [...]
});
```

### Analytics
```typescript
// Prompt distribution
const counts = await promptRepo.getCountBySource();
console.log('OCR:', counts.ocr);
console.log('LLM:', counts.llm);
console.log('User:', counts.user);

// User's exam history
const submissions = await submissionRepo.getByUser(userId);
submissions.forEach(s => {
  console.log(`${s.examId}: ${s.totalScore} points`);
});

// Prompt usage tracking
const examsUsing = await examQuestionRepo.getExamsUsingPrompt(promptId);
console.log(`Prompt used in ${examsUsing.length} exams`);
```

---

## 10. Troubleshooting

### Error: Module not found
```typescript
// ❌ Wrong
import { PromptRepository } from './PromptRepository';

// ✅ Correct
import { PromptRepository } from './PromptRepository.js';
```

### Error: Validation failed
```typescript
// Check required fields
const result = await promptRepo.create({
  questionText: "...",    // Required
  subject: "...",         // Required
  generateVia: 'user',    // Required: 'llm' | 'ocr' | 'user'
  createdBy: "...",       // Required
});

if (!result.success) {
  console.log('Error:', result.error);  // Shows what's missing
}
```

### Slow Queries
```bash
# Run indexes script
cd backend/src/database/scripts
node create-indexes.js
```

---

## Need More Info?

- **Full Documentation**: [README.md](./repositories/README.md)
- **Architecture**: [ARCHITECTURE_DIAGRAM.md](./ARCHITECTURE_DIAGRAM.md)
- **Migration Guide**: [MIGRATION_CHECKLIST.md](./MIGRATION_CHECKLIST.md)
- **Before/After**: [BEFORE_AFTER_COMPARISON.md](./BEFORE_AFTER_COMPARISON.md)

---

## Summary

✅ **1 line** to import: `import { promptRepo } from './repositories/index.js'`  
✅ **9 methods** vs 31 functions  
✅ **Type-safe** with IntelliSense  
✅ **Same API** as before (just organized better)  

**Ready to code!** 🚀

---

## Pro Tips

1. **Use singleton instances** from `index.ts` (don't create new instances)
2. **Check `result.success`** before using data
3. **Use `createBulk()`** for OCR pipelines (faster)
4. **Cache exam details** with Redis (frequent reads)
5. **Run `create-indexes.js`** for better performance

---

## Cheat Sheet

| Task | Repository | Method |
|------|-----------|--------|
| Create question | `promptRepo` | `.create(data)` |
| Search questions | `promptRepo` | `.search(filters)` |
| OCR batch insert | `promptRepo` | `.createBulk(data[])` |
| Review low confidence | `promptRepo` | `.getLowConfidenceOcr()` |
| Create exam | `examRepo` | `.createWithPrompts(data)` |
| Get exam details | `examRepo` | `.getWithFullDetails(id)` |
| Start exam | `submissionRepo` | `.start(examId, userId)` |
| Auto-save | `submissionRepo` | `.updateProgress(id, data)` |
| Submit exam | `submissionRepo` | `.finalize(id, false)` |
| Grade exam | `submissionRepo` | `.evaluate(id, evaluation)` |

**Copy-paste this cheat sheet into your IDE!**

---

Happy coding! 🎉
