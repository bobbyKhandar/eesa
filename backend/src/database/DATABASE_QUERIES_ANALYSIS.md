# Database Queries Analysis - New Schema Architecture

## Schema Architecture Overview

The new architecture follows a normalized design pattern:
- **Prompt** (Central Question Library) → Immutable questions stored once
- **ExamQuestion** (Exam Instance) → References Prompt with exam-specific config (marks, options)
- **Exam** → References ExamQuestions and assigned users
- **ExamSubmission** → User's attempt at an Exam
- **User** → Student/Teacher with exam assignments and history

## Key Query Patterns

### 1. Prompt (Question Library) Queries

#### 1.1 Create Prompt (OCR/LLM/Manual)
```typescript
// Create new question in central library
// Used by: OCR pipeline, LLM generator, manual entry
db.prompts.insertOne({
  questionText: string,
  subject: ObjectId,
  topic?: string,
  generateVia: 'ocr' | 'llm' | 'user',
  source?: string, // PDF name for OCR
  ocrConfidence?: number,
  createdBy: ObjectId,
  bloomsLevel?: string
})
```
**Indexes needed**: `{ subject: 1, topic: 1 }`, `{ generateVia: 1, ocrConfidence: -1 }`

#### 1.2 Search Prompts by Subject/Topic
```typescript
// Find questions for exam creation
// Used by: Exam creation UI, question bank browser
db.prompts.find({
  subject: ObjectId,
  topic?: string,
  bloomsLevel?: { $in: ['remember', 'understand'] }
}).sort({ createdAt: -1 })
```
**Indexes needed**: `{ subject: 1, createdAt: -1 }`, `{ subject: 1, topic: 1, bloomsLevel: 1 }`

#### 1.3 Find Low Confidence OCR Questions
```typescript
// Quality control for OCR-generated questions
// Used by: Review dashboard for teachers
db.prompts.find({
  generateVia: 'ocr',
  ocrConfidence: { $lt: 0.85 }
}).sort({ ocrConfidence: 1 })
```
**Indexes needed**: `{ generateVia: 1, ocrConfidence: 1 }`

#### 1.4 Get Prompt by ID with Validation
```typescript
// Retrieve single question
// Used by: Exam question preview, editing
db.prompts.findById(promptId)
```
**Indexes needed**: `{ _id: 1 }` (automatic)

---

### 2. ExamQuestion (Exam Instance) Queries

#### 2.1 Create ExamQuestion
```typescript
// Create exam-specific question instance
// Used by: Exam creation flow
db.examQuestions.insertOne({
  promptId: ObjectId, // Reference to Prompt
  options: [
    { text: string, isCorrect: boolean },
    { text: string, isCorrect: boolean },
    { text: string, isCorrect: boolean },
    { text: string, isCorrect: boolean }
  ],
  marks: number,
  negativeMarks?: number,
  answerType: 'mcq' | 'multiple-select' | 'short' | 'long',
  createdAt: Date
})
```
**Indexes needed**: `{ promptId: 1 }` (for finding all exams using a prompt)

#### 2.2 Bulk Create ExamQuestions
```typescript
// Create multiple exam questions at once
// Used by: Exam creation with multiple questions
db.examQuestions.insertMany([...examQuestionObjects])
```

#### 2.3 Get ExamQuestion with Prompt Details
```typescript
// Fetch question with full prompt text
// Used by: Exam taking UI, exam preview
db.examQuestions.aggregate([
  { $match: { _id: { $in: examQuestionIds } } },
  { $lookup: {
      from: 'prompts',
      localField: 'promptId',
      foreignField: '_id',
      as: 'promptDetails'
  }},
  { $unwind: '$promptDetails' }
])
```
**Indexes needed**: `{ _id: 1 }`, `{ promptId: 1 }` on ExamQuestion

---

### 3. Exam Queries

#### 3.1 Create Exam with Questions
```typescript
// Create exam and link exam questions
// Used by: Teacher exam creation flow
// Step 1: Create ExamQuestions (as above)
// Step 2: Create Exam referencing those IDs
db.exams.insertOne({
  examTitle: string,
  examDescription: string,
  subject: ObjectId,
  questions: [examQuestionId1, examQuestionId2, ...],
  assignedUsers: [userId1, userId2, ...],
  examMaxMarks: number,
  passingPercentage: number,
  duration?: number,
  scheduledAt?: Date,
  createdBy: ObjectId,
  negativeMarking: boolean
})
```
**Indexes needed**: `{ subject: 1 }`, `{ assignedUsers: 1 }`, `{ scheduledAt: 1 }`

#### 3.2 Get Exam with Full Question Details
```typescript
// Complex aggregation for exam taking
// Used by: Student exam page, teacher preview
db.exams.aggregate([
  { $match: { _id: examId } },
  { $lookup: {
      from: 'examQuestions',
      localField: 'questions',
      foreignField: '_id',
      as: 'questionDetails'
  }},
  { $unwind: '$questionDetails' },
  { $lookup: {
      from: 'prompts',
      localField: 'questionDetails.promptId',
      foreignField: '_id',
      as: 'questionDetails.promptData'
  }},
  { $unwind: '$questionDetails.promptData' },
  { $group: {
      _id: '$_id',
      examData: { $first: '$$ROOT' },
      questions: { $push: '$questionDetails' }
  }}
])
```
**Performance Note**: This is a 3-level join. Consider denormalizing or caching for frequently accessed exams.

**Indexes needed**: `{ questions: 1 }` on Exam, `{ promptId: 1 }` on ExamQuestion

#### 3.3 Get User's Assigned Exams
```typescript
// Fetch all exams assigned to a user
// Used by: Student dashboard
db.exams.find({
  assignedUsers: { $in: [userId] }
}).sort({ scheduledAt: -1 })
```
**Indexes needed**: `{ assignedUsers: 1, scheduledAt: -1 }`

#### 3.4 Get Exams by Subject
```typescript
// Filter exams by subject
// Used by: Subject page, teacher exam management
db.exams.find({
  subject: subjectId,
  createdBy: teacherId
}).sort({ createdAt: -1 })
```
**Indexes needed**: `{ subject: 1, createdBy: 1, createdAt: -1 }`

---

### 4. ExamSubmission Queries

#### 4.1 Create Exam Submission (Start Exam)
```typescript
// Initialize submission when student starts exam
// Used by: Exam start action
db.examSubmissions.insertOne({
  examId: ObjectId,
  userId: ObjectId,
  status: 'IN_PROGRESS',
  responses: [],
  startedAt: new Date(),
  timeSpent: 0
})
```
**Indexes needed**: `{ examId: 1, userId: 1 }` (compound unique for preventing duplicates)

#### 4.2 Update Submission (Save Answers)
```typescript
// Save student's answers during exam
// Used by: Auto-save, manual save during exam
db.examSubmissions.updateOne(
  { _id: submissionId, status: 'IN_PROGRESS' },
  { $set: {
      responses: [
        { examQuestionId, response: answer, isCorrect?: boolean },
        ...
      ],
      timeSpent: minutes
  }}
)
```
**Indexes needed**: `{ _id: 1, status: 1 }` (compound for status-based updates)

#### 4.3 Submit Exam (Finalize)
```typescript
// Mark exam as submitted
// Used by: Submit button, auto-submit on timeout
db.examSubmissions.updateOne(
  { _id: submissionId },
  { $set: {
      status: 'SUBMITTED',
      submittedAt: new Date(),
      autoSubmitted: boolean
  }}
)
```

#### 4.4 Evaluate Submission (Grade)
```typescript
// Teacher or auto-grader evaluates submission
// Used by: Grading flow, MCQ auto-grader
db.examSubmissions.updateOne(
  { _id: submissionId },
  { $set: {
      status: 'EVALUATED',
      evaluatedAt: new Date(),
      totalScore: number,
      'responses.$[].allottedMarks': number,
      'responses.$[].feedback': string
  }}
)
```

#### 4.5 Get Submission by ID
```typescript
// Fetch single submission with exam details
// Used by: Results page, teacher review
db.examSubmissions.aggregate([
  { $match: { _id: submissionId } },
  { $lookup: {
      from: 'exams',
      localField: 'examId',
      foreignField: '_id',
      as: 'examData'
  }},
  { $unwind: '$examData' },
  { $lookup: {
      from: 'users',
      localField: 'userId',
      foreignField: '_id',
      as: 'userData'
  }},
  { $unwind: '$userData' }
])
```
**Indexes needed**: `{ _id: 1 }`, `{ examId: 1 }`, `{ userId: 1 }` on ExamSubmission

#### 4.6 Get All Submissions for Exam
```typescript
// Teacher view of all student submissions
// Used by: Grading dashboard, analytics
db.examSubmissions.find({
  examId: examId
}).populate('userId', 'name email')
  .sort({ submittedAt: -1 })
```
**Indexes needed**: `{ examId: 1, submittedAt: -1 }`

#### 4.7 Get User's Submission History
```typescript
// Student's past exams
// Used by: Student profile, history page
db.examSubmissions.find({
  userId: userId,
  status: 'EVALUATED'
}).populate('examId', 'examTitle subject')
  .sort({ submittedAt: -1 })
```
**Indexes needed**: `{ userId: 1, status: 1, submittedAt: -1 }`

---

### 5. User Queries

#### 5.1 Get User with Assigned Exams
```typescript
// Fetch user with current exam assignments
// Used by: Dashboard, exam list
db.users.findById(userId)
  .populate('currentAllocatedExams')
  .populate('submissionHistory')
```
**Indexes needed**: `{ _id: 1 }`, arrays benefit from multi-key indexes on populated fields

#### 5.2 Update User Exam Allocation
```typescript
// Assign exam to users
// Used by: Teacher exam assignment flow
db.users.updateMany(
  { _id: { $in: userIds } },
  { $addToSet: { currentAllocatedExams: examId } }
)
```

#### 5.3 Move Exam to History
```typescript
// After submission, move from current to history
// Used by: Post-submission cleanup
db.users.updateOne(
  { _id: userId },
  {
    $pull: { currentAllocatedExams: examId },
    $addToSet: { submissionHistory: submissionId }
  }
)
```

---

## Performance Optimization Recommendations

### Critical Indexes to Create

```javascript
// Prompt indexes
db.prompts.createIndex({ subject: 1, topic: 1 })
db.prompts.createIndex({ subject: 1, createdAt: -1 })
db.prompts.createIndex({ generateVia: 1, ocrConfidence: 1 })
db.prompts.createIndex({ subject: 1, topic: 1, bloomsLevel: 1 })

// ExamQuestion indexes
db.examQuestions.createIndex({ promptId: 1 }) // Find all exams using a prompt

// Exam indexes
db.exams.createIndex({ assignedUsers: 1, scheduledAt: -1 })
db.exams.createIndex({ subject: 1, createdBy: 1, createdAt: -1 })
db.exams.createIndex({ questions: 1 })

// ExamSubmission indexes (MOST CRITICAL)
db.examSubmissions.createIndex({ examId: 1, userId: 1 }, { unique: true }) // Prevent duplicate submissions
db.examSubmissions.createIndex({ examId: 1, submittedAt: -1 })
db.examSubmissions.createIndex({ userId: 1, status: 1, submittedAt: -1 })
db.examSubmissions.createIndex({ _id: 1, status: 1 }) // For status-based updates

// User indexes
db.users.createIndex({ email: 1 }, { unique: true })
db.users.createIndex({ currentAllocatedExams: 1 })
```

### Caching Strategy

**Cache Frequently Accessed Data:**
1. **Exam with Questions** - Cache for duration of exam session (Redis key: `exam:${examId}:full`)
2. **User's Assigned Exams** - Short TTL (5 min) to reduce dashboard load
3. **Prompt Details** - Long TTL (1 hour) since prompts are immutable

### Denormalization Considerations

**Trade-off Analysis:**
- **Current Normalized Design**: Better for data consistency, reusability
- **Potential Denormalization**: Store prompt text directly in ExamQuestion for faster reads

**Recommendation**: Start with normalized design. Denormalize only if aggregation queries exceed 500ms under load.

---

## Query Complexity Analysis

| Query Type | Collections Joined | Expected Latency | Volume | Priority |
|------------|-------------------|------------------|--------|----------|
| Get Exam with Questions | 3 (Exam → ExamQuestion → Prompt) | 100-300ms | High | Critical |
| User Dashboard | 2 (User → Exam) | 50-100ms | Very High | Critical |
| Submit Exam | 1 (ExamSubmission update) | 10-20ms | High | Critical |
| Search Prompts | 1 (Prompt query) | 20-50ms | Medium | High |
| Grading Dashboard | 2 (ExamSubmission → User) | 50-150ms | Medium | High |

---

## Migration Strategy

When deploying this schema:

1. **Create new collections** (Prompt, ExamQuestion) alongside existing Question
2. **Migrate existing questions** to Prompt collection with `generateVia: 'user'`
3. **Create ExamQuestion instances** for existing exams
4. **Update Exam documents** to reference ExamQuestion IDs
5. **Keep old Question model** for backward compatibility during transition
6. **Gradually deprecate** old schema over 2-3 releases

---

## Monitoring & Alerts

Set up monitoring for:
- **Slow Queries** (>500ms) on Exam aggregation pipeline
- **Duplicate Submission Attempts** (unique index violations)
- **Unsubmitted Exams** (status: IN_PROGRESS for >exam duration + 1 hour)
- **Low OCR Confidence** (ocrConfidence < 0.7) - flag for manual review
