# Backend Domain Rules — Shared Data Layer

## Build & Module System
- **Module type:** ESM (`"type": "module"` in package.json). Use ES import/export syntax.
- **Build:** TypeScript compiled to `dist/` via `npm run build` (runs `tsc`). Target ES2020, lib ES2021, module ESNext, moduleResolution Bundler. `src/scripts`, `src/database/scripts`, and the example `src/services/examOcrService.ts` are excluded: the scripts run through `tsx`, and the example imports a Gemini module that is not in the tree. The frontend `prebuild` runs this compile so `@/backend/dist/...` exists before `next build`.
- **Output:** `dist/` mirrors `src/` structure. Frontend API routes import from `@/backend/dist/...`.
- **Scripts:** `npm run build` (tsc), `npm run generate-data` (seed script), `npm run build:scripts` (compile scripts separately).

## Zod Schemas (`src/database/schemas/`)
- **All 17 schema files** must import `z` from `../zodGlobal.ts`, NOT from `"zod"` directly. `zodGlobal.ts` calls `extendZod(z)` once for `@zodyac/zod-mongoose` compatibility.
- Each schema exports a Zod schema object (e.g., `examZodSchema`) and a TypeScript type (e.g., `Exam`).
- Schemas define all domain models: exam, question, subject, user, prompt, examQuestion, examSubmission, jobMetadata, uploadSession, uniqueQuestion, analysisReport, examAnalysis, pastPaper, syllabus.
- Barrel file `schemas/index.ts` re-exports all types and Zod schemas.

## Mongoose Models (`src/database/mongooseSchemas.ts` and `src/database/newFeatureModels.ts`)
- **Two model source files:**
  - `mongooseSchemas.ts` — 9 models (questions, examSets, subjects, user, ExamSubmission, Prompt, ExamQuestion, JobMetadata, UploadSession)
  - `newFeatureModels.ts` — 6 models (Subject, Syllabus, PastPaper, ExamAnalysis, AnalysisReport, uniquequestions)
- **Subject collections are distinct.** The legacy question-bank model (`subjectName`, `analysisReportIds`) uses the physical collection `subjects`. The academic catalog model (`name`, `code`, …) uses `featureSubjects`. Both model names pluralize to `subjects` if no collection is set, so each model passes an explicit collection name (`subjectCollections.ts`). `connect()` runs an idempotent split: catalog documents already stored in `subjects` are copied to `featureSubjects` and removed from `subjects` only after the copy exists. Question-bank documents stay in `subjects`. The managed-collection registry still lists both `subjects` and `Subject`, and refuses to back up or truncate when two registry entries share one physical collection.
- **Pattern:** Lazy singleton initialization via getter functions. Each getter checks `models[name]` first, creates only if not cached:
  ```ts
  export function getQuestionModel(): Model<Question> {
    return models["questions"] || model("questions", questionSchema);
  }
  ```
- All Mongoose schemas are generated from Zod via `@zodyac/zod-mongoose`'s `zodSchema(zodSchemaObject)`.
- **Never define raw Mongoose schemas** — always go through Zod + `zodSchema()`.

## Database Connection (`src/database/connect.ts`)
- **Exports:** `connect()` and `disconnect()`.
- **Pattern:** State machine based on `mongoose.connection.readyState` (0=disconnected, 1=connected, 2=connecting, 3=disconnecting).
- **Idempotent:** Every call checks the current state before connecting. Safe to call multiple times.
- **Returns:** `{ successCode: 0|1|2|3|-1, message: string }`.
- **Env:** Reads `mongodb_url` from `process.env` (loaded via `dotenv`).
- **Call in API routes:** Every API route method must call `await connect()` before any DB operation.

## Repositories (`src/database/repositories/`)
- **12 standalone classes.** No base class or abstract class exists. Each is independent.
- **Constructor pattern:** Each repository gets its model via a getter function:
  ```ts
  export class ExamRepository {
    private model: Model<Exam>;
    constructor() {
      this.model = getExamModel();
    }
  }
  ```
- **All methods call `await connect()`** at the start before using `this.model`.
- **CRUD return pattern:** Most methods return `{ success: boolean, id?: string, error?: string }` — a lightweight Result pattern.
- **ID handling:** String IDs throughout. Use `Types.ObjectId.createFromHexString()` for queries, `_id.toString()` for returns.
- **Lean queries:** Use `.lean()` for read operations.
- **insertMany:** Some methods use `insertMany` instead of `.save()` to bypass Mongoose pre-save hooks (e.g., `ExamRepository.createWithPrompts`, `ExamSubmissionRepository.create`).
- **Validation:** Some repositories Zod-validate input before DB operations (PromptRepository, ExamQuestionRepository, UserRepository, JobMetadataRepository, UploadSessionRepository). Follow the caller's pattern.

### Repository Index (`repositories/index.ts`)
- Exports all 12 classes by name.
- Also creates **5 singleton instances** via dynamic `await import()`:
  `promptRepo`, `examQuestionRepo`, `examRepo`, `submissionRepo`, `userRepo`.
- Frontend API routes can either import singleton instances or instantiate directly.

### Repository List

| Repository | Model Source | Key Methods |
|---|---|---|
| `ExamRepository` | `mongooseSchemas.ts` | `createWithPrompts()`, `getWithFullDetails()`, `assignToUsers()`, standard CRUD. `delete()` soft-deletes (`deletedAt`) and clears user allocations. It keeps the exam and its questions so saved submissions can still join them. Listing queries use `activeExamQuery()` and omit deleted exams. `getById()` and `getWithFullDetails()` still return a deleted exam for historical reads. `getWithFullDetails()` returns `questionDetails` in the order of the exam's `questions` array. |
| `ExamSubmissionRepository` | `mongooseSchemas.ts` | `claimPending()`, `completePending()`, `releasePending()`, `create()`, `updateResponses()`, `getByExamAndUser()`, `getByScoreRange()`. `claimPending()` inserts a `gradingStatus: "pending"` row so the unique `examId + userId` index is taken before Gemini grading. A duplicate key returns the existing row. `releasePending()` deletes only that pending row so a failed grade can be retried. `completePending()` sets scores and `gradingStatus: "complete"` without unsetting a legacy `answers` map. List and id reads omit pending claims. A missing `gradingStatus` stays a finished legacy submission. |
| `ExamQuestionRepository` | `mongooseSchemas.ts` | `create()`, `createBulk()`, `getWithPrompt()`, `getExamsUsingPrompt()` |
| `ExamAnalysisRepository` | `newFeatureModels.ts` | `create()`, `getByUser()`, `publish()`, `getPublicAnalyses()` |
| `AnalysisReportRepository` | `newFeatureModels.ts` | `create()`, `update()`, `findBySubject()`, `getSubjectsSummary()`, `getRecentReports()`. Public reads use `publicAnalysisReportFilter()` so `publishStatus: "pending"` stays out of the question bank. |
| `SubjectRepository` | `newFeatureModels.ts` | `create()`, `getByCode()`, `getAll(filters)`, `getStatistics()` |
| `UserRepository` | `mongooseSchemas.ts` | `create()`, `getByIds()`, `getAllocatedExams()`, `assignExam()`, `assignExamToMany()`, `getByRole()` |
| `PromptRepository` | `mongooseSchemas.ts` | `create()`, `createBulk()`, `search()`, `getLowConfidenceOcr()`, `findBySubject()` (public bank only; excludes unpublished `generateVia: "user"` exam prompts) |
| `JobMetadataRepository` | `mongooseSchemas.ts` | `create()`, `findById()`, `findByJobIds()`, `updateStatus()`, `findOlderThan()` |
| `UploadSessionRepository` | `mongooseSchemas.ts` | `create()`, `findById()`, `addJobs()`, `updateJobStats()` |
| `UniqueQuestionRepository` | `newFeatureModels.ts` | `findOrCreate()` upserts by normalized text + subject and links each analysis report once (a retry does not increment `occurrenceCount`), `findBySubject()`, `getMostFrequent()`, `searchByText()` |

## Services (`src/services/`)

| Service | Role |
|---|---|
| `geminiAi.js` | Google Gemini AI integration (458 lines) — postAnswers, getBloomsAnatomy, refineSyllabus, sendEmail |
| `examAnalysisService.ts` | Gemini-powered exam analysis — extracts questions, classifies Bloom's, maps to syllabus |
| `examEvaluationService.ts` | Grades a submission. Objective items use the answer key. Free-text grading keeps instructions in the Gemini system instruction and puts the question, rubric, and student response in delimited untrusted-data blocks. Client `maxMarks` is ignored; allotted marks are clamped to the server mark. |
| `examSubmissionClaim.ts` | Decides which concurrent submit owns grading. The winner inserts a pending submission; a duplicate key does not grade again. Grading failure releases the pending row. The score update does not touch legacy `answers`. |
| `ocrService.ts` | HTTP client for AI Pipeline OCR service (axios). Polls `completed` and `partial`. `interpretOcrFileResult` (`ocrFileResult.ts`) keeps text from successful pages, records `failedPages`, and returns `status: "partial"` instead of a clean success. It returns `status: "failed"` when no text remains, including when every page failed. |
| `ec2OcrClient.ts` | Axios client for EC2-based AI Pipeline |
| `publishAnalysisService.ts` | Orchestrates AnalysisReport, Prompt, UniqueQuestion creation. Publication is a pending → complete state machine (`publishAnalysisMachine.ts`): only a completed report counts as already published, and a retry resumes the pending report instead of inserting another one. |
| `questionSimilarityService.ts` | Bidirectional similarity linking between prompts (MongoDB). `findSimilarQuestionsInDB` treats a missing `isActive` as active and matches stored `questionText`. Public-bank exclusion of unpublished `generateVia: "user"` exam drafts stays in `publicQuestionBank.ts` / `PromptRepository.findBySubject()`. |
| `s3CleanupService.ts` | Validates S3 files, marks expired jobs in MongoDB |
| `databaseBackupService.ts` | S3 backup and restore of the managed collections. Restore writes every collection into a side collection and renames it into place only after the full payload is staged, so a failed insert or publish leaves live data unchanged (or rolls a partial publish back). A backup whose metadata status is `failed` is refused before any write. |
| `examOcrService.ts` | EC2 OCR + exam analysis workflow |
| `generateBloomsAnatomy.ts` | Bloom's taxonomy classification (mostly commented out) |

## Scripts (`src/scripts/` and `src/database/scripts/`)

| Script | Purpose |
|---|---|
| `generate-sample-data.ts` | Seeds MongoDB with test prompts, exams, submissions |
| `create-indexes.ts` | Creates MongoDB indexes for performance |
| `migrate-schema.ts` | Copies legacy questions into prompts and ExamQuestion documents. Each ExamQuestion uses `questionType` (`MCQ`, `TEXT`, or `TRUE_FALSE`) plus the legacy options, answer, and marks. A per-exam failure leaves that exam unchanged and makes the script exit non-zero. Re-runs skip exams that already store ExamQuestion ids and do not rewrite assignees, `createdBy`, or `deletedAt`. Submission answers are translated into `responses` before a submission is written. A submission that cannot be mapped is left unchanged. The legacy `answers` field is kept, so a re-run restores responses that an older run emptied and, when the stable ExamQuestion id matches, attaches them to the question already stored on the exam. A submission write that does not match the stored document is rolled back. |
| `importBedrockQuestions.ts` | Imports Bedrock-enriched JSON -> Prompts, UniqueQuestions, etc. |
| `importOcrQuestions.ts` | Imports OCR-processed question papers |
| `dryRunOcrImport.ts` | Preview OCR import without modifying DB |

## Dependencies
- **Core:** `mongoose` ^8.19.1, `zod` ^3.25.76, `@zodyac/zod-mongoose` ^4.1.0
- **AWS:** `@aws-sdk/client-bedrock-runtime` ^3.1022.0, `aws4` ^1.13.2
- **AI:** `@google/generative-ai` ^0.24.1
- **HTTP:** `axios` ^1.12.2
- **Dev:** `typescript` ^5.9.2, `tsx` ^4.20.6, `ts-node` ^10.9.2
- **Note:** `express` and `@types/express` are still in dependencies but **must not be used** — Express has been removed from the codebase.
