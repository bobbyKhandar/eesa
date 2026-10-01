# Global Project Rules

## Project Setup
- This is **EESA (Enterprise Exam Scoring Architecture)** — a **modular monolith** with 3 packages under `packages/`: `backend/`, `frontend/`, `ai-pipeline/`. All code lives in a single deployable unit.

## Stack
- **Frontend:** Next.js 15 (App Router), TypeScript, Tailwind CSS v3, shadcn/ui, Clerk auth
- **Backend:** Node.js, TypeScript (ESM), Mongoose 8, Zod 3, `@zodyac/zod-mongoose`
- **AI Pipeline:** Python 3.10+, Flask, flask-cors, EasyOCR, OpenCV, PyMuPDF, Pillow, boto3, Redis, LanceDB
- **Database:** MongoDB Atlas
- **Auth:** Clerk

## CRITICAL ARCHITECTURAL RULES

### NO EXPRESS.JS
Express has been deprecated and removed. All backend CRUD APIs now live in `packages/frontend/app/api/` (Next.js Route Handlers). Never generate Express code.

### DB Connection
MongoDB is accessed via `packages/backend/src/database/connect.ts` using ready-state caching to prevent pool exhaustion. Never generate raw `mongoose.connect()` calls inside individual API routes. Call the shared `connect()` function instead.

### AI/Python Boundary
The Next.js frontend NEVER talks to AWS Textract or Bedrock directly. It must send POST requests to the Flask AI Pipeline (`http://127.0.0.1:5000`). The AI pipeline owns all AWS integration.

### Auth & Session Identity
Identity is derived from the Clerk session, never from a request body. `packages/frontend/middleware.ts` protects `/dashboard(.*)` and `/api/users(.*)` (302 to `/sign-in` for pages, 401 JSON for API routes), and `app/dashboard/layout.tsx` re-checks the session server-side. Roles are assigned server-side by `packages/backend/src/services/userProvisioning.ts`; `UserRepository.upsertByClerkId` is the only writer of a local user record. See the "Auth Flow" section of `README.md`.

### Package-Specific Rules
See the `context.md` file inside each package for domain-specific rules:
- `packages/frontend/context.md` — React/TypeScript component and data-fetching patterns
- `packages/backend/context.md` — Repository, schema, and model patterns
- `packages/ai-pipeline/context.md` — Python/Flask pipeline architecture and threading rules
