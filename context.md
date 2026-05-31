# Global Project Rules

## Architecture
- **Modular monolith** — 3 packages under `packages/`: `backend/`, `frontend/`, `ai-pipeline/`
- **No Express.js** — All backend CRUD lives in `packages/frontend/app/api/` (Next.js API routes). Never generate Express code.
- **Frontend owns the web server** — Next.js App Router on port 3000 serves everything. No separate backend server.

## Database
- **MongoDB via repositories only** — `packages/backend/src/database/repositories/`. Never call `mongoose.connect()` or raw Mongoose queries in API routes.
- **Connection managed by** `packages/backend/src/database/connect.ts` (singleton pattern).
- **Schemas defined in Zod** — `packages/backend/src/database/schemas/`. Mongoose models generated via `@zodyac/zod-mongoose`.

## AI / Python Boundary
- **Next.js NEVER talks to AWS directly** — It sends HTTP POST requests to the Flask AI pipeline (`http://127.0.0.1:5000`).
- **AI pipeline owns all AWS integration** — Textract OCR, Bedrock parsing/enrichment.
- **Pipeline modes:** Local (EasyOCR) and AWS (Textract + Bedrock → parsing → enrichment → organization → clustering).

## Tech Stack
- **Frontend:** Next.js 15 (App Router), TypeScript, Tailwind CSS v3, shadcn/ui, Radix UI, Clerk auth, Recharts
- **Backend:** TypeScript (ESM), Mongoose 8, Zod 3, `@zodyac/zod-mongoose`
- **AI Pipeline:** Python 3.10+, Flask, OpenCV, EasyOCR, boto3, PyMuPDF, LanceDB, FAISS, HDBSCAN
- **VSCode:** 2 launch profiles (Frontend :3000, AI Pipeline :5000)
