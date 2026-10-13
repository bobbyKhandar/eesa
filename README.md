# EESA — Enterprise Exam Scoring Architecture

A modular monolith for end-to-end exam processing: upload scanned question papers, run OCR + AI enrichment, create and manage exams, collect student submissions, and generate analysis reports.

---

## Features

- **OCR Pipeline** — Upload scanned PDFs/images; EasyOCR local mode (free) or AWS Textract + Bedrock pipeline for parsing, enrichment, and subject organization
- **Question Clustering** — FAISS + HDBSCAN similarity-based clustering of extracted questions
- **Exam Management** — Create exams with theory, multiple-choice, and true/false questions, organize by subject/syllabus, assign teacher exams to selected students, and publish them. Assigned students still cannot open a scheduled exam before `scheduledAt`.
- **Student Submissions** — Take exams, auto-grading, result analysis
- **Resource Library** — Upload and browse notes, PYQs, and study materials with subject filtering
- **Admin Tools** — Database stats, S3 backup/restore, collection truncation, query editor, performance monitoring, job status monitoring, failed job retry. A restore loads the whole backup, writes each collection into a side collection, and swaps it into place only after every collection is written, so a failed restore does not leave live data half-wiped. Backups marked failed are still refused.
- **AI Analysis** — Bloom's taxonomy classification, exam analysis reports, Gemini-powered exam helper
- **Clerk Authentication** — Secure login via email, Google, or GitHub

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js, Mongoose 8, Zod, `@zodyac/zod-mongoose` |
| Frontend | Next.js 15 (App Router), TypeScript |
| UI | shadcn/ui, Radix UI, Tailwind CSS v3, Lucide icons, Recharts |
| Auth | Clerk (Next.js SDK) |
| Database | MongoDB Atlas |
| AI/OCR | AWS Textract, AWS Bedrock (Gemma 3 27B), Google Gemini, EasyOCR |
| Vector Storage | LanceDB (FAISS + HDBSCAN clustering) |
| Pipeline | Python 3.10+, Flask, flask-cors, EasyOCR, OpenCV, PyMuPDF, Pillow, Redis, boto3 |
| DevOps | Monorepo (npm workspaces), Embedded Conda env, VSCode launch configs |

---

## Architecture

The project is a **modular monolith** — everything lives in one repo but is organized into three packages under `packages/`:

```
eesa/
├── packages/
│   ├── backend/                    # Shared data layer (repositories, schemas, services)
│   ├── frontend/                   # Next.js app :3000 (owns the full web server)
│   └── ai-pipeline/                # Python Flask :5000
├── data/                           # Runtime outputs, uploads, cache
├── tests/
│   ├── node/                       # Node.js test suites (placeholder)
│   └── python/                     # Python test suites
├── .vscode/                        # Debug configs (2 launch profiles)
├── .conda/                         # Embedded Conda Python 3.11 environment
└── SCHEMAS_SUMMARY.md              # Database schema documentation
```

### Communication Pattern

```
Frontend (Next.js) ────┬── MongoDB (via repositories)
       │               └── HTTP ──▶ AI Pipeline (Flask) ──▶ AWS (Textract, Bedrock, S3)
       │
       └── (Clerk auth)
```

The **Next.js frontend** owns the full web server — API routes handle all CRUD by importing repository classes from `@/backend/dist/database/repositories/` and calling `connect()` from `@/backend/dist/database/connect.js`. The `@/` path alias (from frontend tsconfig `"@/*": [".././*"]`) resolves to the repo root, so `@/backend/` maps to `packages/backend/`. The **AI pipeline** is a standalone Flask server called via HTTP when OCR/enrichment jobs need processing. No Express middleware layer exists between the frontend and the database.

> See [`context.md`](./context.md) for authoritative global project rules.

---

## Project Structure

### `packages/backend/`

> See [`packages/backend/context.md`](./packages/backend/context.md) for authoritative backend rules.

```
packages/backend/
├── src/
│   ├── database/
│   │   ├── connect.ts               # MongoDB connection manager
│   │   ├── mongooseSchemas.ts       # Zod-to-Mongoose schema conversion
│   │   ├── newFeatureModels.ts      # Catalog Subject model uses collection featureSubjects
│   │   ├── subjectCollections.ts    # Keeps legacy `subjects` and catalog `featureSubjects` apart
│   │   ├── repositories/            # Data access layer (12 files, domain-separated)
│   │   │   ├── ExamRepository.ts
│   │   │   ├── ExamSubmissionRepository.ts
│   │   │   ├── ExamQuestionRepository.ts
│   │   │   ├── ExamAnalysisRepository.ts
│   │   │   ├── AnalysisReportRepository.ts
│   │   │   ├── SubjectRepository.ts
│   │   │   ├── UserRepository.ts
│   │   │   ├── JobMetadataRepository.ts
│   │   │   ├── UploadSessionRepository.ts
│   │   │   ├── UniqueQuestionRepository.ts
│   │   │   ├── PromptRepository.ts
│   │   │   └── index.ts             # Barrel exports + singleton instances
│   │   ├── schemas/                 # 17 Zod schemas & TypeScript types
│   │   └── scripts/                 # Utility scripts (generate-data, migrate, indexes)
│   ├── services/                    # Business logic (13 files)
│   │   ├── examAnalysisService.ts   # AI-based exam analysis
│   │   ├── examOcrService.ts        # OCR service orchestration
│   │   ├── ocrService.ts
│   │   ├── geminiAi.js              # Google Gemini AI integration
│   │   ├── generateBloomsAnatomy.ts # Bloom's taxonomy classification
│   │   ├── publishAnalysisService.ts
│   │   ├── questionSimilarityService.ts
│   │   ├── ec2OcrClient.ts
│   │   ├── s3CleanupService.ts
│   │   └── ...
│   ├── scripts/                     # Migration/import scripts
│   └── utils/multer.js              # File upload middleware
└── package.json
```

### `packages/frontend/`

> See [`packages/frontend/context.md`](./packages/frontend/context.md) for authoritative frontend rules.

```
packages/frontend/
├── app/
│   ├── api/                         # 15 API route directories
│   │   ├── exams/                   # Create, list, display, details, exam sets
│   │   ├── subjects/                # Subject listing, from-job
│   │   ├── upload/                  # Question paper upload & split
│   │   ├── jobs/                    # Job status, retry & cleanup
│   │   ├── failed-jobs/             # Failed job details & bulk retry
│   │   ├── submissions/             # Submit & get results
│   │   ├── resources/               # Resource CRUD
│   │   ├── admin/database/          # DB stats, S3 backup/restore, truncation
│   │   ├── exam-analysis/           # Publish, upload, upload-bulk, upload-bulk-zip
│   │   ├── llm/                     # Gemini AI exam helper
│   │   ├── users/                   # User CRUD, student roster, submissions, metadata
│   │   ├── upload-sessions/         # Upload session management
│   │   ├── results/                 # Results retrieval
│   │   ├── reports/                 # Report generation
│   │   └── unique-questions/        # Unique questions retrieval
│   ├── admin/                       # Admin pages (database, upload, analytics, etc.)
│   ├── dashboard/                   # User dashboard, exam creation
│   ├── exams/                       # Exam listing & taking
│   ├── resources/                   # Resource library
│   ├── subjects/                    # Subject explorer
│   ├── take-exam/                   # Exam-taking interface
│   ├── ai-analyze/                  # AI exam analysis
│   ├── ai-helper/                   # Gemini exam helper
│   └── upload-status/               # Upload session tracking
├── components/
│   ├── ui/                          # 50 shadcn/ui components
│   ├── features/                    # Domain-organized feature components
│   │   ├── admin/                   # DatabaseStatCard, ConfirmTruncateDialog, SqlQueryEditor
│   │   ├── exams/                   # ExamTypeSelector, QuestionEditor, SubjectSelector, StudentAssigneeSelector
│   │   ├── resources/               # UploadResourceDialog, NoteCard, PyqsTable, SearchFilterBar
│   │   └── upload/                  # JobStatusBadge, StageDetails, StatusMessage
│   ├── permanent-sidebar.tsx
│   ├── top-navigation.tsx
│   ├── theme-provider.tsx
│   └── notification-system.tsx
├── hooks/                           # use-mobile, use-toast
├── lib/utils.ts                     # cn() utility (clsx + tailwind-merge)
├── middleware.ts                    # Clerk auth middleware
└── package.json
```

### `packages/ai-pipeline/`

> See [`packages/ai-pipeline/context.md`](./packages/ai-pipeline/context.md) for authoritative AI pipeline rules.

```
packages/ai-pipeline/
├── server.py                        # Unified pipeline server (1124 lines)
├── src/
│   ├── server.py                    # Bootstrap (19 lines — imports from api/)
│   ├── api/                         # Extracted API module
│   │   ├── __init__.py              # create_app, AWSPipelineManager exports
│   │   ├── server.py                # AIServer class, start/stop logic (96 lines)
│   │   ├── routes.py                # Flask route handlers (86 lines)
│   │   └── aws_manager.py           # AWSPipelineManager orchestrator (100 lines)
│   ├── aws_texttract_pipeline.py    # AWS Textract document processing
│   ├── parsing_pipeline.py          # Bedrock-based question parsing
│   ├── enrich_questions_job_based.py    # Question enrichment with Bedrock
│   ├── organize_by_subject_job_based.py # Subject organization
│   ├── intelligent_chunking.py      # Document chunking for large PDFs
│   ├── chunk_merger.py              # Merge chunked results
│   ├── question_clustering.py       # FAISS + HDBSCAN clustering
│   ├── local_ocr_engine.py          # EasyOCR-based local processing
│   ├── local_image_processor_pipeline.py
│   ├── pdf_handler.py
│   ├── docx_handler.py              # DOCX text extraction (not OCR)
│   ├── pipeline_manager.py
│   ├── pipeline_orchestrator.py
│   ├── batch_runner.py
│   ├── manual_pipeline.py
│   ├── textract_extract_text.py
│   ├── redis_client.py / redisMaster.py  # Redis integration
│   └── reprocess_errors.py
├── imagePreprocess.py               # Image preprocessing module
├── constants.py                     # Enums (JobStatus, Severity, etc.)
├── tests/                           # 15 test files
├── requirements-ocr.txt
├── pyproject.toml
├── wsgi.py                          # Gunicorn WSGI entry point
└── start_server.py                  # Server starter
```

---

## Getting Started

### Prerequisites

- **Node.js** >= 18 + npm
- **Python** >= 3.10 + pip (or use embedded `.conda/`)
- **MongoDB Atlas** account (or local MongoDB)
- **AWS** account (for Textract + Bedrock features)
- **Clerk** account (for authentication)

### 1. Clone & Install Dependencies

```bash
git clone https://github.com/bobbyKhandar/eesa.git
cd eesa

# Install all Node.js workspace packages (backend + frontend)
npm install

# AI Pipeline Python dependencies
cd packages/ai-pipeline && pip install -r requirements-ocr.txt && cd ../..
```

### 2. Configure Environment Variables

Each package has its own `.env` file:

**`packages/backend/.env`**
| Variable | Description |
|----------|-------------|
| `mongodb_url` | MongoDB Atlas connection string |
| `gemini_api_key` | Google Gemini API key |
| `TEST_EMAIL` | Test user email for development |

**`packages/frontend/.env.local`**
| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key |
| `CLERK_SECRET_KEY` | Clerk secret key |
| `AI_PIPELINE_URL` | AI Pipeline server URL (`http://127.0.0.1:5000`) |
| `AI_PIPELINE_TOKEN` | Shared secret sent as `Authorization: Bearer` to every AI pipeline route except `/health`. Set the same value in `packages/ai-pipeline/.env`. |

**`packages/ai-pipeline/.env`**
| Variable | Description |
|----------|-------------|
| `APPLICATION_EMAIL` | Sender email for notifications |
| `APPLICATION_EMAIL_PASSWORD` | Email app password |
| `APPLICATION_ADMIN` | Admin email address |
| `aws_location` | AWS region (e.g. `ap-south-1`) |
| `AI_PIPELINE_TOKEN` | Shared secret required on every route except `GET /health`. Must match the frontend value. |
| `AI_PIPELINE_BIND` | Gunicorn bind address (default `127.0.0.1:5000`). Public binds need `AI_PIPELINE_ALLOW_PUBLIC_BIND=1`. |
| `AI_PIPELINE_TRUSTED_HOSTS` | Comma-separated client IPs allowed to call sensitive routes, in addition to loopback. |
| `AI_PIPELINE_ALLOW_REMOTE` | Set to `1` to skip the client-address check. The token is still required. |

The Eesa database is `test`. Set the server-side `mongodb_url` to `mongodb+srv://bobby:<URL_ENCODED_PASSWORD>@cluster0.yuld0s6.mongodb.net/test?appName=Cluster0`; URL-encode the database-user password and keep credentials in ignored environment files. Use the same URI in the root `.env` (for root-run scripts) and `packages/backend/.env` (for the shared connection helper). An inherited `mongodb_url` takes precedence over dotenv files, so update any deployment environment that supplies it and restart the app. A local database migration does not verify a production switch; verify the deployed environment and running app separately.

### 3. Run in Development

Open **two terminals**:

```bash
# Terminal 1 — Frontend (port 3000)
cd packages/frontend
npm run dev

# Terminal 2 — AI Pipeline (port 5000)
cd packages/ai-pipeline
python src/server.py
```

Or use **VSCode** (`.vscode/launch.json`) — open Run & Debug (Ctrl+Shift+D), select a profile, press F5:

| Profile | Path |
|---------|------|
| **Frontend (Next.js)** | Launches Next.js dev server on port 3000 |
| **AI Pipeline (Flask)** | Launches Flask server on port 5000 |

---

## API Overview

### Frontend API Routes (`packages/frontend/app/api/`)

| Prefix | Purpose |
|--------|---------|
| `exams/` | Create, list, details, exam sets, display |
| `subjects/` | Subject listing, from-job |
| `upload/` | Question paper upload & split |
| `jobs/` | Status, retry, cleanup |
| `failed-jobs/` | Failed job details, bulk retry |
| `submissions/` | Submit & get results |
| `resources/` | Resource CRUD |
| `admin/database/` | DB stats, S3 backup/restore, truncation |
| `exam-analysis/` | Publish, upload, upload-bulk, upload-bulk-zip |
| `llm/` | Gemini AI exam helper |
| `users/` | User CRUD, submissions, metadata |
| `upload-sessions/` | Upload session management |
| `results/` | Results retrieval |
| `reports/` | Report generation |
| `unique-questions/` | Unique questions retrieval |

### AI Pipeline Routes

All routes registered on the canonical server at `src/api/server.py`. See `packages/ai-pipeline/context.md` for full documentation.

| Route | Method | Description |
|-------|--------|-------------|
| `/health` | GET | Health check (no credential) |
| `/process` | POST | Start a single AWS pipeline job. Optional `s3_bucket` selects the bucket `head_object` checks and the worker reads; omitted or blank uses `S3_BUCKET`. Requires `Authorization: Bearer $AI_PIPELINE_TOKEN` from loopback or `AI_PIPELINE_TRUSTED_HOSTS`. The same credential applies to every route below. |
| `/process/batch` | POST | Batch process multiple AWS jobs. Optional `s3_bucket` is passed into each job; omitted or blank uses `S3_BUCKET`. |
| `/job/<id>/status` | GET | AWS job full stage details (from S3 metadata) |
| `/job/<id>/metadata` | GET | Alias for `/job/<id>/status` |
| `/job/<id>/questions` | GET | Processed questions with 3-level S3 fallback + Bloom's stats |
| `/job/<id>/retry` | POST | Re-queue a failed or partial-success job from its original S3 PDF |
| `/jobs/active` | GET | List active AWS jobs |
| `/submit-local` | POST | Submit local EasyOCR batch |
| `/submit` | POST | Legacy alias for `/submit-local` |
| `/submit-aws` | POST | Submit AWS batch job (legacy interface) |
| `/status-aws/<job_id>` | GET | AWS job status (legacy interface) |
| `/status/<batch_id>` | GET | Local batch status |
| `/result/<batch_id>` | GET | Local batch result |
| `/upload/question-papers` | POST | Upload PDFs from frontend, uploads to S3, starts pipeline |

---

## Scripts

### Backend (`packages/backend/package.json`)

| Script | Description |
|--------|-------------|
| `npm run build` | TypeScript compilation |
| `npm run generate-data` | Generate sample data in MongoDB |

### Frontend (`packages/frontend/package.json`)

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Next.js dev server |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run lint` | ESLint check |

---

## Testing

| Location | Framework | Contents |
|----------|-----------|----------|
| `packages/ai-pipeline/tests/` | Python unittest | 15 test files (server, OCR, pipeline, AWS, integration) |
| `tests/python/` | Python unittest | 2 test files (experiment, image preprocessing) |
| `tests/node/` | — | Empty (placeholder for future Node.js tests) |

---

## Refactoring Status

| Work Item | Status |
|-----------|--------|
| **Monorepo layout** — Moved `backend/`, `frontend/`, `ai_pipeline/` → `packages/` | ✅ Done |
| **Legacy directory purge** — Removed `deprecated/`, `debugging-temp/`, `server_aws_only.py.bak` | ✅ Done |
| **Data consolidation** — All runtime data → `data/` | ✅ Done |
| **Test consolidation** — All tests → `tests/node/` + `tests/python/` | ✅ Done |
| **Express removal** — Removed Express server, routes, and `db.ts` facade | ✅ Done |
| **Database layer** — 12 domain-separated repository files, direct imports | ✅ Done |
| **Frontend mammoth splits** — 4 pages split, 17 feature component files created | ✅ Done |
| **AI pipeline API extraction** — Extracted `api/` module from monolithic `server.py` | ✅ Done |
| **VSCode configs** — `launch.json` (2 profiles) + `settings.json` | ✅ Done |

### Key Design Decisions

- **Feature components** live under `components/features/<domain>/` with barrel exports via `index.ts`
- **API routes** live in `app/api/` and import repositories from `@/backend/dist/database/repositories/`
- **Repositories** are imported directly by consumers — no facade or God object. Both singleton instances (from `repositories/index.ts`) and direct instantiation (`new RepositoryName()`) are used.
- **Raw Mongoose models** are also used directly in some API routes (e.g., `getUserModel().findById(userId)`), alongside the repository pattern.
- **No Express server** — Next.js API routes are the sole backend entry point (besides the Python AI pipeline)
- **Git history** is fully preserved — all moves detected as 100% similar (R100)
