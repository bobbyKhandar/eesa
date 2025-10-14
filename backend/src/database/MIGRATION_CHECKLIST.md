# Migration Checklist

Use this checklist to migrate from the old `db.ts` to the new repository pattern.

---

## Phase 1: Setup & Testing (Week 1)

### ✅ Step 1: Verify Repository Files
- [ ] All repository files exist in `backend/src/database/repositories/`
  - [ ] `PromptRepository.ts`
  - [ ] `ExamQuestionRepository.ts`
  - [ ] `ExamRepository.ts`
  - [ ] `ExamSubmissionRepository.ts`
  - [ ] `index.ts`
- [ ] Documentation exists:
  - [ ] `README.md`
  - [ ] `REFACTORING_SUMMARY.md`
  - [ ] `BEFORE_AFTER_COMPARISON.md`
  - [ ] `ARCHITECTURE_DIAGRAM.md`

### ✅ Step 2: Generate Sample Data
```bash
cd backend/src/database/scripts
node generate-sample-data.js --clear --count=50
```

- [ ] Script runs without errors
- [ ] Prompts created (50 total)
  - [ ] ~15 OCR questions (confidence 0.78-0.95)
  - [ ] ~15 LLM questions (analytical)
  - [ ] ~20 User questions (simple)
- [ ] Exams created (~10)
- [ ] Submissions created (~30)
- [ ] Check MongoDB:
  ```bash
  mongosh
  use your_database
  db.prompts.countDocuments()      # Should show 50
  db.exams.countDocuments()        # Should show ~10
  db.submissions.countDocuments()  # Should show ~30
  ```

### ✅ Step 3: Test Repository Methods

Create a test file: `backend/src/database/test-repositories.js`

```javascript
import { 
  promptRepo, 
  examRepo, 
  submissionRepo 
} from './repositories/index.js';

async function test() {
  // Test 1: Search prompts
  const prompts = await promptRepo.search({ 
    subject: "Mathematics",
    limit: 10 
  });
  console.log('✅ Found prompts:', prompts.length);

  // Test 2: Get low confidence OCR
  const lowConf = await promptRepo.getLowConfidenceOcr(0.85, 10);
  console.log('✅ Low confidence prompts:', lowConf.length);

  // Test 3: Get exam with full details
  const exams = await examRepo.getBySubject("Mathematics");
  if (exams.length > 0) {
    const examDetails = await examRepo.getWithFullDetails(exams[0]._id);
    console.log('✅ Exam details:', examDetails.examTitle);
    console.log('  Questions:', examDetails.questions.length);
  }

  // Test 4: Get submissions
  const submissions = await submissionRepo.getByExam(exams[0]._id);
  console.log('✅ Submissions:', submissions.length);

  console.log('\n✅ All tests passed!');
}

test().catch(console.error);
```

Run:
```bash
node test-repositories.js
```

- [ ] All tests pass
- [ ] Data is returned correctly
- [ ] No errors in console

---

## Phase 2: Update One Route (Week 2)

### ✅ Step 4: Choose a Simple Route to Migrate

Pick one route to start with (e.g., `GET /api/prompts/search`)

**Before (using db.ts):**
```typescript
// routes/prompts.ts
import { searchPrompts } from '../database/db.js';

router.get('/search', async (req, res) => {
  const { subject, topic } = req.query;
  const prompts = await searchPrompts({ subject, topic });
  res.json(prompts);
});
```

**After (using repository):**
```typescript
// routes/prompts.ts
import { promptRepo } from '../database/repositories/index.js';

router.get('/search', async (req, res) => {
  const { subject, topic } = req.query;
  const prompts = await promptRepo.search({ subject, topic });
  res.json(prompts);
});
```

- [ ] Update import statement
- [ ] Replace function call with repository method
- [ ] Test endpoint with Postman/curl
- [ ] Verify response format matches old API

### ✅ Step 5: Test Updated Route

```bash
# Using curl
curl http://localhost:3000/api/prompts/search?subject=Mathematics

# Using Postman
GET http://localhost:3000/api/prompts/search
Query params: { "subject": "Mathematics" }
```

- [ ] Route returns correct data
- [ ] Response format unchanged
- [ ] No errors in server logs

---

## Phase 3: Migrate All Routes (Week 3-4)

### ✅ Step 6: Migrate Prompt Routes

File: `backend/src/routes/prompts.ts`

- [ ] `POST /api/prompts` → `promptRepo.create()`
- [ ] `POST /api/prompts/bulk` → `promptRepo.createBulk()`
- [ ] `GET /api/prompts/:id` → `promptRepo.getById()`
- [ ] `GET /api/prompts/search` → `promptRepo.search()`
- [ ] `GET /api/prompts/low-confidence` → `promptRepo.getLowConfidenceOcr()`
- [ ] `PUT /api/prompts/:id` → `promptRepo.update()`
- [ ] `GET /api/prompts/source/:source` → `promptRepo.getBySource()`
- [ ] `DELETE /api/prompts/:id` → `promptRepo.delete()`
- [ ] `GET /api/prompts/stats` → `promptRepo.getCountBySource()`

Test all endpoints:
- [ ] Create prompt works
- [ ] Bulk create works
- [ ] Search works
- [ ] Get by ID works
- [ ] Update works
- [ ] Delete works

### ✅ Step 7: Migrate Exam Routes

File: `backend/src/routes/exams.ts`

- [ ] `POST /api/exams` → `examRepo.createWithPrompts()`
- [ ] `GET /api/exams/:id` → `examRepo.getWithFullDetails()`
- [ ] `POST /api/exams/:id/assign` → `examRepo.assignToUsers()`
- [ ] `GET /api/exams/subject/:subject` → `examRepo.getBySubject()`
- [ ] `GET /api/exams/creator/:creator` → `examRepo.getByCreator()`
- [ ] `PUT /api/exams/:id` → `examRepo.update()`
- [ ] `DELETE /api/exams/:id` → `examRepo.delete()`

Test all endpoints:
- [ ] Create exam with questions works
- [ ] Get exam details works (3-level join)
- [ ] Assign to users works
- [ ] Filter by subject works
- [ ] Update works
- [ ] Delete works

### ✅ Step 8: Migrate Submission Routes

File: `backend/src/routes/submissions.ts`

- [ ] `POST /api/submissions/start` → `submissionRepo.start()`
- [ ] `PUT /api/submissions/:id/progress` → `submissionRepo.updateProgress()`
- [ ] `POST /api/submissions/:id/submit` → `submissionRepo.finalize()`
- [ ] `POST /api/submissions/:id/evaluate` → `submissionRepo.evaluate()`
- [ ] `GET /api/submissions/:id` → `submissionRepo.getById()`
- [ ] `GET /api/submissions/exam/:examId` → `submissionRepo.getByExam()`
- [ ] `GET /api/submissions/user/:userId` → `submissionRepo.getByUser()`
- [ ] `DELETE /api/submissions/:id` → `submissionRepo.delete()`

Test all endpoints:
- [ ] Start submission works
- [ ] Auto-save progress works
- [ ] Submit works
- [ ] Evaluate works
- [ ] Get submissions works

---

## Phase 4: Add Tests (Week 5)

### ✅ Step 9: Write Unit Tests

Create test files:
- `backend/src/database/repositories/__tests__/PromptRepository.test.ts`
- `backend/src/database/repositories/__tests__/ExamRepository.test.ts`
- `backend/src/database/repositories/__tests__/ExamSubmissionRepository.test.ts`

Example test:
```typescript
import { PromptRepository } from '../PromptRepository.js';

describe('PromptRepository', () => {
  let promptRepo: PromptRepository;

  beforeEach(() => {
    promptRepo = new PromptRepository();
  });

  it('should create a prompt', async () => {
    const result = await promptRepo.create({
      questionText: "Test question",
      subject: "Test Subject",
      generateVia: 'user',
      createdBy: "test_user"
    });

    expect(result.success).toBe(true);
    expect(result.promptId).toBeDefined();
  });

  it('should reject invalid prompt', async () => {
    const result = await promptRepo.create({
      questionText: "",  // Invalid
      subject: "Test",
      generateVia: 'user',
      createdBy: "test_user"
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Validation failed');
  });
});
```

- [ ] Tests for PromptRepository (9 methods)
- [ ] Tests for ExamQuestionRepository (6 methods)
- [ ] Tests for ExamRepository (8 methods)
- [ ] Tests for ExamSubmissionRepository (8 methods)
- [ ] All tests pass: `npm test`

---

## Phase 5: Integration Testing (Week 6)

### ✅ Step 10: End-to-End Testing

Test complete workflows:

**Workflow 1: OCR Pipeline**
- [ ] Upload PDF
- [ ] OCR extracts questions
- [ ] Bulk create prompts via `promptRepo.createBulk()`
- [ ] Review low confidence via `promptRepo.getLowConfidenceOcr()`
- [ ] Update reviewed prompts via `promptRepo.update()`

**Workflow 2: Create & Take Exam**
- [ ] Teacher creates exam via `examRepo.createWithPrompts()`
- [ ] Exam assigned to students
- [ ] Student starts exam via `submissionRepo.start()`
- [ ] Student answers questions
- [ ] Auto-save via `submissionRepo.updateProgress()`
- [ ] Student submits via `submissionRepo.finalize()`
- [ ] System evaluates via `submissionRepo.evaluate()`
- [ ] Student views result

**Workflow 3: Analytics**
- [ ] Get prompt count by source via `promptRepo.getCountBySource()`
- [ ] Get all exams by subject via `examRepo.getBySubject()`
- [ ] Get user submission history via `submissionRepo.getByUser()`

### ✅ Step 11: Performance Testing

- [ ] Run indexes script: `node create-indexes.js`
- [ ] Test with large datasets (1000+ prompts)
- [ ] Measure query times:
  ```javascript
  console.time('search');
  await promptRepo.search({ subject: "Math" });
  console.timeEnd('search'); // Should be < 50ms
  ```
- [ ] Test 3-level join performance:
  ```javascript
  console.time('examDetails');
  await examRepo.getWithFullDetails(examId);
  console.timeEnd('examDetails'); // Should be < 300ms
  ```

---

## Phase 6: Deprecate Old Code (Week 7)

### ✅ Step 12: Remove Old Imports

- [ ] Search codebase for `import { ... } from './database/db.js'`
- [ ] Replace all with repository imports
- [ ] Verify no routes use old db.ts

```bash
# Find all db.ts imports
grep -r "from.*database/db.js" backend/src/routes/
grep -r "from.*database/db.js" backend/src/services/

# Should return 0 results
```

### ✅ Step 13: Archive Old File

- [ ] Rename `db.ts` to `db.deprecated.ts`
- [ ] Add comment at top:
  ```typescript
  /**
   * @deprecated Use repositories instead
   * @see backend/src/database/repositories/
   */
  ```
- [ ] Keep file for 1-2 releases, then delete

### ✅ Step 14: Update Documentation

- [ ] Update main README with repository usage
- [ ] Update API documentation
- [ ] Add migration guide to team wiki
- [ ] Notify team of changes

---

## Phase 7: Monitoring (Ongoing)

### ✅ Step 15: Monitor Production

After deployment:

- [ ] Monitor error logs for repository-related errors
- [ ] Check query performance
- [ ] Verify all endpoints working
- [ ] Monitor database load
- [ ] Track API response times

### ✅ Step 16: Collect Feedback

- [ ] Developer feedback on new structure
- [ ] Any confusion or issues?
- [ ] Suggestions for improvement?
- [ ] Update documentation based on feedback

---

## Rollback Plan (If Needed)

If issues arise:

### Option 1: Use Facade
```typescript
// Keep using old function signatures
import { searchPrompts } from './database/db.refactored.js';
// Internally uses repositories, but same API
```

### Option 2: Revert Specific Route
```typescript
// Temporarily revert one route back to db.ts
import { searchPrompts } from './database/db.js';
```

### Option 3: Full Rollback
```bash
# Revert to commit before migration
git revert <commit-hash>
```

---

## Success Metrics

### Code Quality
- [ ] File size reduced by 83% (1200 → 250 lines max)
- [ ] IntelliSense suggestions reduced by 70% (31 → 9 methods)
- [ ] 100% test coverage for repositories
- [ ] 0 linting errors

### Performance
- [ ] Search queries < 50ms
- [ ] 3-level joins < 300ms
- [ ] Create operations < 100ms
- [ ] No increase in database load

### Developer Experience
- [ ] New developers onboarded 50% faster
- [ ] Time to find methods reduced by 80%
- [ ] Code reviews 40% faster
- [ ] Fewer merge conflicts

---

## Team Responsibilities

### Backend Lead
- [ ] Review all migrated routes
- [ ] Approve test coverage
- [ ] Sign off on performance benchmarks

### QA Team
- [ ] Test all workflows end-to-end
- [ ] Verify no regressions
- [ ] Document any issues

### DevOps
- [ ] Monitor deployment
- [ ] Track error rates
- [ ] Set up alerts for anomalies

### All Developers
- [ ] Use repositories for new features
- [ ] Write tests for new methods
- [ ] Update documentation

---

## Timeline Summary

| Phase | Duration | Tasks | Status |
|-------|----------|-------|--------|
| **Phase 1** | Week 1 | Setup & verify | ⬜ Not Started |
| **Phase 2** | Week 2 | Migrate one route | ⬜ Not Started |
| **Phase 3** | Week 3-4 | Migrate all routes | ⬜ Not Started |
| **Phase 4** | Week 5 | Add unit tests | ⬜ Not Started |
| **Phase 5** | Week 6 | Integration testing | ⬜ Not Started |
| **Phase 6** | Week 7 | Deprecate old code | ⬜ Not Started |
| **Phase 7** | Ongoing | Monitor & improve | ⬜ Not Started |

---

## Quick Reference

### Import Old Way
```typescript
import { 
  createPrompt, 
  searchPrompts 
} from '../database/db.js';
```

### Import New Way
```typescript
import { 
  promptRepo,
  examRepo,
  submissionRepo 
} from '../database/repositories/index.js';
```

### Function Mapping

| Old Function | New Method |
|-------------|------------|
| `createPrompt()` | `promptRepo.create()` |
| `createPromptBulk()` | `promptRepo.createBulk()` |
| `searchPrompts()` | `promptRepo.search()` |
| `createExamWithPrompts()` | `examRepo.createWithPrompts()` |
| `getExamWithFullDetails()` | `examRepo.getWithFullDetails()` |
| `startExamSubmission()` | `submissionRepo.start()` |
| `finalizeExamSubmission()` | `submissionRepo.finalize()` |

---

## Help & Resources

- **Documentation**: `backend/src/database/repositories/README.md`
- **Examples**: `backend/src/database/REFACTORING_SUMMARY.md`
- **Architecture**: `backend/src/database/ARCHITECTURE_DIAGRAM.md`
- **Comparison**: `backend/src/database/BEFORE_AFTER_COMPARISON.md`

**Questions?** Check the documentation first, then ask the team.

---

## Final Checklist

Before marking migration complete:

- [ ] All routes migrated to repositories
- [ ] All tests passing (100% coverage)
- [ ] Performance benchmarks met
- [ ] Documentation updated
- [ ] Team trained on new structure
- [ ] Old db.ts deprecated
- [ ] Production monitoring in place
- [ ] Rollback plan tested

**When all boxes checked**: Migration complete! 🎉

---

## Notes

Use this space to track issues, decisions, or important findings during migration:

```
Date: _____________
Issue: ____________________________________________________________
Resolution: _______________________________________________________

Date: _____________
Issue: ____________________________________________________________
Resolution: _______________________________________________________

Date: _____________
Issue: ____________________________________________________________
Resolution: _______________________________________________________
```

---

**Good luck with the migration! The new structure will make development much more enjoyable.** 🚀
