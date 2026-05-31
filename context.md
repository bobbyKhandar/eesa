# Global Project Rules

## Architecture
- **Modular monolith** — 3 packages under `packages/`: `backend/`, `frontend/`, `ai-pipeline/`. All code lives in a single deployable unit.
- **No Express.js** — Express has been deprecated and removed. All backend CRUD logic lives in `packages/frontend/app/api/` (Next.js API routes). Never generate Express code.
- **Frontend owns the web server** — Next.js App Router on port 3000 serves the full application. No separate backend server exists.
- **Path alias** — Frontend tsconfig maps `@/*` to repo root (`baseUrl: ".", paths: {"@/*": [".././*"]}`). So `@/backend/dist/...` resolves to `packages/backend/dist/...`.

## Database
- **MongoDB** accessed via `packages/backend/src/database/connect.ts` — a singleton connection manager that checks `mongoose.connection.readyState` before connecting. Call `await connect()` in API routes before any DB operation.
- **Repositories** live in `packages/backend/src/database/repositories/`. Import singleton instances from `/repositories/index.ts` or instantiate via `new RepositoryName()`.
- **Zod schemas** define all data models in `packages/backend/src/database/schemas/`. Mongoose models are generated from Zod using `@zodyac/zod-mongoose` in `packages/backend/src/database/mongooseSchemas.ts`.
- **Raw Mongoose models** are also used directly in some API routes (e.g., `getUserModel().findById()`). This is an accepted pattern alongside repositories.

## AI / Python Boundary
- **Next.js NEVER talks to AWS Textract or Bedrock directly.** It sends HTTP requests to the Flask AI pipeline at `AI_PIPELINE_URL` (default `http://localhost:5000` or `http://192.168.1.105:5000`).
- **AI pipeline owns all AWS integration** — Textract OCR, Bedrock parsing, enrichment, organization, and FAISS/HDBSCAN clustering.
- **Two pipeline modes:**
  - **Local** — EasyOCR-based processing (free, slower)
  - **AWS** — Textract OCR -> Bedrock Parsing -> Bedrock Enrichment -> Subject Organization -> Question Clustering (paid, production-ready)
- **Two server entry points:**
  - `packages/ai-pipeline/server.py` (1124 lines) — Unified pipeline server with all endpoints baked in
  - `packages/ai-pipeline/src/server.py` (19 lines) — Thin bootstrap that imports from `src/api/` module
- **`src/api/` module** contains extracted AIServer class (96 lines), Flask routes (86 lines), and AWSPipelineManager (100 lines).

## Tech Stack
- **Frontend:** Next.js 15 (App Router), TypeScript, Tailwind CSS v3 (with shadcn/ui theme), Radix UI, Clerk auth, Recharts, Lucide icons
- **Backend:** TypeScript (ESM, ES2020), Mongoose 8, Zod 3, `@zodyac/zod-mongoose`, `@aws-sdk/client-bedrock-runtime`, `@google/generative-ai`
- **AI Pipeline:** Python 3.10+, Flask, OpenCV, EasyOCR, boto3, PyMuPDF, Pillow, LanceDB, FAISS, HDBSCAN, Redis
- **Testing:** Python unittest (15 test files in `packages/ai-pipeline/tests/`, 2 in `tests/python/`)
- **VSCode:** 2 launch profiles (Frontend :3000, AI Pipeline :5000)

## Frontend Domain Rules
- **Component hierarchy:** UI feature components live in `components/features/<domain>/` with barrel exports via `index.ts`.
- **API routes** import repositories from `@/backend/dist/database/repositories/` and call `connect()` from `@/backend/dist/database/connect.js`.
- **Styling:** Uses shadcn/ui components from `components/ui/`, Tailwind CSS v3 utility classes, and CSS variables defined in `globals.css`. Do not write custom CSS files.

## AI Pipeline Domain Rules
- **Framework:** Flask (Python 3.10+).
- **Task execution:** Heavy AI tasks (OCR, Bedrock parsing) use `ThreadPoolExecutor` from `concurrent.futures`.
- **AWS integration:** Uses `boto3` for Textract and Bedrock. Credentials read from `.env` via `os.environ`.
- **Redis:** Used for job queue management (`redis_client.py`, `redisMaster.py`).
- **LanceDB:** Used for vector storage in question clustering with FAISS + HDBSCAN.
