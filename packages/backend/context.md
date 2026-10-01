# Backend Domain Rules — Shared Data Layer

## Build & Module System
- **Module type:** ESM (`"type": "module"` in package.json). Use ES import/export syntax.
- **Build:** TypeScript compiled to `dist/` via `npm run build` (runs `tsc`). Target ES2020, module ESNext, moduleResolution Bundler.
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
| `ExamRepository` | `mongooseSchemas.ts` | `createWithPrompts()`, `getWithFullDetails()`, `assignToUsers()`, standard CRUD |
| `ExamSubmissionRepository` | `mongooseSchemas.ts` | `create()`, `updateResponses()`, `getByExamAndUser()`, `getByScoreRange()` |
| `ExamQuestionRepository` | `mongooseSchemas.ts` | `create()`, `createBulk()`, `getWithPrompt()`, `getExamsUsingPrompt()` |
| `ExamAnalysisRepository` | `newFeatureModels.ts` | `create()`, `getByUser()`, `publish()`, `getPublicAnalyses()` |
| `AnalysisReportRepository` | `newFeatureModels.ts` | `create()`, `findBySubject()`, `getSubjectsSummary()`, `getRecentReports()` |
| `SubjectRepository` | `newFeatureModels.ts` | `create()`, `getByCode()`, `getAll(filters)`, `getStatistics()` |
| `UserRepository` | `mongooseSchemas.ts` | `create()`, `getAllocatedExams()`, `assignExam()`, `getByRole()` |
| `PromptRepository` | `mongooseSchemas.ts` | `create()`, `createBulk()`, `search()`, `getLowConfidenceOcr()` |
| `JobMetadataRepository` | `mongooseSchemas.ts` | `create()`, `findById()`, `updateStatus()`, `findOlderThan()` |
| `UploadSessionRepository` | `mongooseSchemas.ts` | `create()`, `findById()`, `addJobs()`, `updateJobStats()` |
| `UniqueQuestionRepository` | `newFeatureModels.ts` | `findOrCreate()`, `findBySubject()`, `getMostFrequent()`, `searchByText()` |

## Services (`src/services/`)

| Service | Role |
|---|---|
| `geminiAi.js` | Google Gemini AI integration (458 lines) — postAnswers, getBloomsAnatomy, refineSyllabus, sendEmail |
| `examAnalysisService.ts` | Gemini-powered exam analysis — extracts questions, classifies Bloom's, maps to syllabus |
| `ocrService.ts` | HTTP client for AI Pipeline OCR service (axios) |
| `ec2OcrClient.ts` | Axios client for EC2-based AI Pipeline |
| `publishAnalysisService.ts` | Orchestrates AnalysisReport, Prompt, UniqueQuestion creation |
| `questionSimilarityService.ts` | Bidirectional similarity linking between prompts (MongoDB) |
| `s3CleanupService.ts` | Validates S3 files, marks expired jobs in MongoDB |
| `examOcrService.ts` | EC2 OCR + exam analysis workflow |
| `generateBloomsAnatomy.ts` | Bloom's taxonomy classification (mostly commented out) |

## Scripts (`src/scripts/` and `src/database/scripts/`)

| Script | Purpose |
|---|---|
| `generate-sample-data.ts` | Seeds MongoDB with test prompts, exams, submissions |
| `create-indexes.ts` | Creates MongoDB indexes for performance |
| `migrate-schema.ts` | Schema migration utility |
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
