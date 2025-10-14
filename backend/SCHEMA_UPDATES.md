# ExamSubmission Schema Updates

## Summary
Added `maxMarks` field to the ExamSubmission schema to track the maximum possible marks for an exam, in addition to the existing `marksAchieved` field which tracks the actual marks obtained.

## Changes Made

### 1. Schema Updates

#### File: `src/database/schemas/examSubmissionsSchemaZod.ts`

**Added:**
```typescript
maxMarks: z.number().optional(), // Maximum marks possible for the exam
```

**Field Descriptions:**
- `maxMarks`: The maximum marks that could be achieved on the exam (total possible score)
- `marksAchieved`: The actual marks obtained by the student (their score)

### 2. Repository Updates

#### File: `src/database/repositories/ExamSubmissionRepository.ts`

**Updated `start()` method:**
- Added optional `maxMarks` parameter
- Now accepts: `start(examId: string, userId: string, maxMarks?: number)`
- Stores maxMarks when submission is created

**Updated `evaluate()` method:**
- Changed from using `scoreObtained` and `totalScore` parameters
- Now stores evaluation as:
  ```typescript
  {
    maxMarks: evaluation.totalScore,    // Total possible marks
    marksAchieved: evaluation.scoreObtained  // Actual marks obtained
  }
  ```

### 3. Sample Data Generator

#### File: `src/database/scripts/generate-sample-data.ts`

**No changes needed** - Already using correct structure with `scoreObtained` and `totalScore` in the evaluate method.

## Schema Structure

### Complete ExamSubmission Schema

```typescript
{
  examId: string,                    // Reference to the exam
  userId: string,                    // Reference to the user
  submittedAt: Date,                 // When submitted
  status: 'IN_PROGRESS' | 'SUBMITTED' | 'EVALUATED',
  
  // Timing
  timeSpent?: number,                // Time in seconds
  autoSubmitted: boolean,            // If auto-submitted
  
  // Results
  maxMarks?: number,                 // Maximum possible marks
  marksAchieved?: number,            // Actual marks obtained
  evaluatorObservations?: string,    // Feedback from evaluator
  
  // Detailed responses
  responses: Array<{
    questionId: string,
    userResponse: string,
    allottedMarks?: number,
    feedback?: string,
    suggestions?: string[]
  }>,
  
  // Email tracking
  emailSent: boolean,
  emailSentAt?: Date
}
```

## Usage Examples

### Starting a Submission (with maxMarks)
```typescript
const result = await submissionRepo.start(
  examId,
  userId,
  100  // maxMarks - total possible marks for the exam
);
```

### Evaluating a Submission
```typescript
await submissionRepo.evaluate(submissionId, {
  scoreObtained: 75,    // Student got 75 marks
  totalScore: 100,      // Out of 100 possible marks
  responses: [...]
});

// This will be stored as:
// maxMarks: 100
// marksAchieved: 75
```

### Querying Results
```typescript
const submission = await submissionRepo.getById(submissionId);

console.log(`Score: ${submission.marksAchieved}/${submission.maxMarks}`);
// Output: "Score: 75/100"

const percentage = (submission.marksAchieved / submission.maxMarks) * 100;
// Percentage: 75%
```

## Database Migration Notes

**No migration needed** - The `maxMarks` and `marksAchieved` fields are optional, so:
- Existing submissions will continue to work
- New submissions can include these fields
- Old submissions without these fields will have `undefined` values

## API Impact

Any API routes that return submission data will now include:
- `maxMarks`: Maximum possible marks
- `marksAchieved`: Actual marks obtained

Frontend should be updated to display these fields appropriately.

## Testing

Run the sample data generator to test:
```bash
cd backend
node dist/database/scripts/generate-sample-data.js
```

This will create submissions with both `maxMarks` and `marksAchieved` populated.
