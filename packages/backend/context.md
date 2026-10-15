# Backend Domain Rules — Shared Data Layer

## Build & Module System
- **Module type:** ESM (`"type": "module"` in package.json). Use ES import/export syntax.
- **Build:** TypeScript compiled to `dist/` via `npm run build` (runs `tsc`). Target ES2020, lib ES2021, module ESNext, moduleResolution Bundler. `src/database/scripts` and the example `src/services/examOcrService.ts` are excluded (the maintenance scripts run through `tsx`; the example imports a Gemini module that is not in the tree). `src/scripts` is compiled so the operational importers have an emitted plain-node entry point (`node dist/scripts/importBedrockQuestions.js`). Because the package is ESM and `dist/` is loaded by plain Node, every relative import in emitted code carries an explicit `.js` extension: Bundler resolution accepts extensionless specifiers and preserves them in the output, where Node throws `ERR_MODULE_NOT_FOUND`. `dist/` is not tracked in git, so the frontend `prebuild` and `predev` steps run `scripts/ensure-backend-build.mjs` — it compiles this package whenever `dist/` is missing, incomplete, or older than `src/`.
- **Output:** `dist/` mirrors `src/` structure. Frontend API routes import from `@/backend/dist/...`.
- **Build order:** the repository-root `npm run build` (this package, then the frontend), the frontend `prebuild`, and the frontend `predev` all compile this package before Next.js starts, because API routes cannot resolve `@/backend/dist/...` without that output.
- **Scripts:** `npm run build` (tsc, emits `dist/` including `dist/scripts/`), `npm run generate-data` (seed script via `tsx`).

## Zod Schemas (`src/database/schemas/`)
- **All 17 schema files** must import `z` from `../zodGlobal.ts`, NOT from `"zod"` directly. `zodGlobal.ts` calls `extendZod(z)` once for `@zodyac/zod-mongoose` compatibility.
- Each schema exports a Zod schema object (e.g., `examZodSchema`) and a TypeScript type (e.g., `Exam`).
- Schemas define all domain models: exam, question, subject, user, prompt, examQuestion, examSubmission, jobMetadata, uploadSession, uniqueQuestion, analysisReport, examAnalysis, pastPaper, syllabus.
- Barrel file `schemas/index.ts` re-exports all types and Zod schemas.

## Mongoose Models (`src/database/mongooseSchemas.ts` and `src/database/newFeatureModels.ts`)
- **Two model source files:**
  - `mongooseSchemas.ts` — 9 models (questions, examSets, subjects, user, ExamSubmission, Prompt, ExamQuestion, JobMetadata, UploadSession)
  - `newFeatureModels.ts` — 6 models (Subject, Syllabus, PastPaper, ExamAnalysis, AnalysisReport, uniquequestions)
- **Subject collections are distinct.** The legacy question-bank model (`subjectName`, `analysisReportIds`) uses the physical collection `subjects`. The academic catalog model (`name`, `code`, …) uses `featureSubjects`. Both model names pluralize to `subjects` if no collection is set, so each model passes an explicit collection name (`subjectCollections.ts`). `connect()` runs an idempotent split: catalog documents already stored in `subjects` are copied to `featureSubjects` and removed from `subjects` only after the copy exists. Question-bank documents stay in `subjects`. The managed-collection registry still lists both `subjects` and `Subject`, and refuses to back up or truncate when two registry entries share one physical collection. Active exam clocks live in `examAttempts` (`ExamAttemptRepository`). That name is registered once, with the model factory bound to the explicit `examAttempts` collection, so admin counts, backup, restore, and truncate include those rows. Completed submissions stay in `ExamSubmission`.
- **Pattern:** Lazy singleton initialization via getter functions. Each getter checks `models[name]` first, creates only if not cached:
  ```ts
  export function getQuestionModel(): Model<Question> {
    return models["questions"] || model("questions", questionSchema);
  }
  ```
- All Mongoose schemas are generated from Zod via `@zodyac/zod-mongoose`'s `zodSchema(zodSchemaObject)`.
- **Never define raw Mongoose schemas** — always go through Zod + `zodSchema()`.
- **Unique questions** use a unique compound index on `normalizedText` + `subject`. A database that already has duplicate pairs cannot build that index until `merge-duplicate-unique-questions.ts` has merged them. The script is a dry run unless `--apply` is passed.

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
- **CRUD return pattern:** Write methods return `{ success: boolean, id?: string, error?: string }` — a lightweight Result pattern. A read that matches nothing returns `[]` or `null` (routes keep that as 200 or 404). A database read failure is thrown, so those routes answer 5xx. An id that is not a document id is absence, not a failure.
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
| `ExamRepository` | `mongooseSchemas.ts` | `createWithPrompts()`, `getWithFullDetails()`, `assignToUsers()`, standard CRUD. `createWithPrompts()` inserts ExamQuestion documents and then the Exam inside the caller's MongoDB transaction when a session is passed. Without a session, a failed exam insert deletes those ExamQuestion documents. User allocation stays best-effort and is skipped while a session is open so it cannot abort the transaction. `delete()` soft-deletes (`deletedAt`) and clears user allocations. It keeps the exam and its questions so saved submissions can still join them. Listing queries use `activeExamQuery()` and omit deleted exams. `getById()` and `getWithFullDetails()` still return a deleted exam for historical reads. `getHistoricalByIds()` loads those same historical exams, including soft-deleted ones, in one `$in` query. `getWithFullDetails()` returns `questionDetails` in the order of the exam's `questions` array. |
| `ExamSubmissionRepository` | `mongooseSchemas.ts` | `claimPending()`, `completePending()`, `releasePending()`, `create()`, `updateResponses()`, `getByExamAndUser()`, `getByScoreRange()`, `summarizeByUser()`. `claimPending()` inserts a `gradingStatus: "pending"` row so the unique `examId + userId` index is taken before Gemini grading. A duplicate key returns the existing row. `releasePending()` deletes only that pending row so a failed grade can be retried. `completePending()` sets scores and `gradingStatus: "complete"` without unsetting a legacy `answers` map. List and id reads omit pending claims. A missing `gradingStatus` stays a finished legacy submission. `getByUser(userId, { limit, cursor })` returns one page of graded history (default 20, max 50), newest first. `summarizeByUser()` aggregates totals, grades, subjects, and months for the whole history. `getByUser(userId)` with no page query is still the unbounded list used by the submissions proxy. |
| `ExamQuestionRepository` | `mongooseSchemas.ts` | `create()`, `createBulk()`, `getWithPrompt()`, `getExamsUsingPrompt()`. `createBulk()` accepts a session. If `insertMany` fails outside a transaction, it deletes any exam questions that write already stored. |
| `ExamAnalysisRepository` | `newFeatureModels.ts` | `create()`, `getByUser()`, `publish()`, `getPublicAnalyses()` |
| `AnalysisReportRepository` | `newFeatureModels.ts` | `create()`, `update()`, `findBySubject()`, `getSubjectsSummary()`, `getRecentReports()`. Public reads use `publicAnalysisReportFilter()` so `publishStatus: "pending"` stays out of the question bank. `pagePublicPromptIds()` returns one page of distinct prompt ids for the resource fallback (default 20, max 50). `summarizeFallbackPyqs()` aggregates years and Bloom counts for that fallback without returning prompt documents. |
| `SubjectRepository` | `newFeatureModels.ts` | `create()`, `getByCode()`, `getAll(filters)`, `getStatistics()` |
| `UserRepository` | `mongooseSchemas.ts` | `create()`, `getByIds()`, `getAllocatedExams()`, `assignExam()`, `assignExamToMany()`, `getByRole()` |
| `PromptRepository` | `mongooseSchemas.ts` | `create()`, `createBulk()`, `deleteManyByIds()`, `search()`, `getLowConfidenceOcr()`, `findBySubject()` (public bank only; excludes unpublished `generateVia: "user"` exam prompts). `createBulk()` accepts a session. If `insertMany` fails outside a transaction, it deletes any prompts that write already stored. |
| `JobMetadataRepository` | `mongooseSchemas.ts` | `create()`, `findById()`, `findByJobIds()`, `updateStatus()`, `findOlderThan()` |
| `UploadSessionRepository` | `mongooseSchemas.ts` | `create()`, `findById()`, `addJobs()`, `updateJobStats()` |
| `UniqueQuestionRepository` | `newFeatureModels.ts` | `findOrCreate()` atomically upserts the unique `normalizedText` + `subject` index (`$setOnInsert`, `$inc`, `$addToSet`) and retries a duplicate-key race. A repeated analysis report does not increment `occurrenceCount`. `findBySubject()` omits `embedding`. Passing `{ limit, cursor }` returns one page (default 20, max 50) sorted by `occurrenceCount` then `_id`, projecting only the resource fields. `getSubjectStats()` stays the aggregate for totals. Also `getMostFrequent()`, `searchByText()` |

## Services (`src/services/`)

| Service | Role |
|---|---|
| `geminiAi.js` | Google Gemini AI integration (458 lines) — postAnswers, getBloomsAnatomy, refineSyllabus, sendEmail |
| `examAnalysisService.ts` | Gemini-powered exam analysis — extracts questions, classifies Bloom's, maps to syllabus |
| `examEvaluationService.ts` | Grades a submission. Objective items use the answer key. Free-text grading keeps instructions in the Gemini system instruction and puts the question, rubric, and student response in delimited untrusted-data blocks. Client `maxMarks` is ignored; allotted marks are clamped to the server mark. |
| `examSubmissionClaim.ts` | Decides which concurrent submit owns grading. The winner inserts a pending submission; a duplicate key does not grade again. Grading failure releases the pending row. The score update does not touch legacy `answers`. |
| `ocrService.ts` | HTTP client for AI Pipeline OCR service (axios). Submission, polling and result download share one elapsed deadline (`OCR_TOTAL_TIMEOUT_MS`, default 120000ms); each request also carries an axios timeout capped to the remaining budget (`OCR_REQUEST_TIMEOUT_MS`, default 60000ms; submission uses `OCR_SUBMIT_TIMEOUT_MS`) plus an `AbortSignal`, so a stalled response can no longer outlive the processing limit. A timeout returns `success: false`, `status: "failed"`, an `OCR ... timed out` message and `retryable: true`, which the upload routes turn into a failed analysis. Polls run `OCR_POLL_INTERVAL_MS` (default 2000ms) apart, bounded by `OCR_MAX_STATUS_ATTEMPTS` (default 60); the deadline, not the attempt counter, bounds network waits. Polls `completed` and `partial`. `interpretOcrFileResult` (`ocrFileResult.ts`) keeps text from successful pages, records `failedPages`, and returns `status: "partial"` instead of a clean success. It returns `status: "failed"` when no text remains, including when every page failed. |
| `ec2OcrClient.ts` | Axios client for EC2-based AI Pipeline |
| `publishAnalysisService.ts` | Orchestrates AnalysisReport, Prompt, UniqueQuestion creation. Publication is a pending → complete state machine (`publishAnalysisMachine.ts`): only a completed report counts as already published, and a retry resumes the pending report instead of inserting another one. |
| `questionSimilarityService.ts` | Bidirectional similarity linking between prompts (MongoDB). `findSimilarQuestionsInDB` treats a missing `isActive` as active and matches stored `questionText`. Public-bank exclusion of unpublished `generateVia: "user"` exam drafts stays in `publicQuestionBank.ts` / `PromptRepository.findBySubject()`. |
| `questionBankPage.ts` | Cursor pages for resource PYQs. Unique-question pages sort by occurrence count then id and project resource fields only (no embedding). The report fallback pages prompt ids and summarizes Bloom totals separately. Default page size 20, max 50. An unusable cursor throws `InvalidQuestionBankCursorError`. |
| `s3CleanupService.ts` | Validates S3 files, marks expired jobs in MongoDB. `markExpiredJobs` counts a job as expired only when `markS3Expired` reports success; a failed or unmatched write keeps `s3_expired` false, lands in `errors` with its job id, and stays in the next cleanup selection. `POST /api/jobs/cleanup` answers that run with 409 and `success: false` instead of a plain success. |
| `databaseBackupService.ts` | S3 backup and restore of the managed collections. `listBackups` follows the `ListObjectsV2` continuation tokens (`IsTruncated` / `NextContinuationToken`) until every backup folder is returned and only sorts the full catalogue afterwards, since S3 caps one page at 1,000 common prefixes and the timestamp folder ids put the newest recovery points on later pages. Restore writes every collection into a side collection and renames it into place only after the full payload is staged, so a failed insert or publish leaves live data unchanged (or rolls a partial publish back). A backup whose metadata status is `failed` is refused before any write. `deleteBackup` folds every `DeleteObjectsCommand` response's `Errors` array into the outcome, counts only the keys S3 removed, and returns the remaining keys with their per-key errors (transient vs permanent) so the admin can retry a backup that is still stored. A delete request that throws reaches the caller untouched. |
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
| `merge-duplicate-unique-questions.ts` | Dry run by default. `--apply` merges duplicate unique questions that share `normalizedText` and `subject` (union of source reports, appearances, and prompt ids; occurrence counts kept) and then replaces a non-unique identity index with the unique one. |

## Dependencies
- **Core:** `mongoose` ^8.19.1, `zod` ^3.25.76, `@zodyac/zod-mongoose` ^4.1.0
- **AWS:** `@aws-sdk/client-bedrock-runtime` ^3.1022.0, `aws4` ^1.13.2
- **AI:** `@google/generative-ai` ^0.24.1
- **HTTP:** `axios` ^1.12.2
- **Dev:** `typescript` ^5.9.2, `tsx` ^4.20.6, `ts-node` ^10.9.2
- **Note:** `express` and `@types/express` are still in dependencies but **must not be used** — Express has been removed from the codebase.
