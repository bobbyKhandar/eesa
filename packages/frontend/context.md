# Frontend Domain Rules — Next.js 15

## Component Hierarchy
- **UI primitives** live in `components/ui/` (45 shadcn/ui components — button, card, dialog, etc.). Import from `@/frontend/components/ui/<name>`.
- **Feature components** live in `components/features/<domain>/`. Always use barrel exports via `index.ts`. Existing domains: `admin/`, `exams/`, `resources/`, `upload/`.
- **Layout shell** is split: `app/layout.tsx` (Server Component — wraps ClerkProvider + ClientLayout) and `app/clientLayout.tsx` ("use client" — sidebar, top nav, mobile toggle).

## Pages & Data Fetching
- **All pages are Client Components ("use client")** except the root `app/page.tsx` (landing page) and `app/layout.tsx`. The entire app uses `useEffect` + `fetch()` for data fetching. **Do not write React Server Components with `async function`** — that pattern is not used here.
- **API Route Handlers** (`app/api/.../route.ts`) are always server-side (no "use client"). These import backend code directly via the `@/` alias.
- **Mutation pattern:** Pages call `fetch("/api/...", { method: "POST", body: ... })` from event handlers. No server actions or React Query.

## Import Paths
- The `@/*` path alias (set in `tsconfig.json` as `"@/*": [".././*"]`) resolves to the **monorepo root** (`C:\project\miniproject/`). So:
  - `@/frontend/...` = frontend package (`packages/frontend/...`)
  - `@/backend/...` = backend package (`packages/backend/...`)
- **Components/pages** import via `@/frontend/`:
  ```tsx
  import { Button } from "@/frontend/components/ui/button"
  import { cn } from "@/frontend/lib/utils"
  import { ExamTypeSelector } from "@/frontend/components/features/exams"
  ```
- **API routes** import backend code via `@/backend/` — both compiled (`dist/`) and source (`src/`) paths are used:
  ```ts
  // From dist (common):
  import { examRepo } from "@/backend/dist/database/repositories/index"
  import { getAllSubjectsWithReports } from "@/backend/dist/services/publishAnalysisService"
  // From src (also valid):
  import { connect } from "@/backend/src/database/connect"
  import { JobMetadataRepository } from "@/backend/src/database/repositories/JobMetadataRepository"
  ```

## Database Access (API routes only)
- **API routes import `connect()`** from `@/backend/src/database/connect` or `@/backend/dist/database/connect` and call `await connect()` before any DB operation.
- **Use repositories** from `@/backend/dist/database/repositories/` (or `src/`). Import singleton instances via `repositories/index.ts` or instantiate directly: `new RepositoryName()`.
- **Raw Mongoose models** are also used in some routes (e.g., `getUserModel().findById(userId)` from `@/backend/src/database/mongooseSchemas`). Both patterns are accepted.
- **Never generate `mongoose.connect()` calls** directly — always use the shared `connect()` function.

## Styling
- **Tailwind CSS v3** (not v4). Config at `tailwind.config.ts` with `tailwindcss-animate` plugin.
- **shadcn/ui components** from `components/ui/`. Do not write custom CSS files — there are only 2 `.css` files (both `globals.css` copies).
- **CSS variables** defined in `app/globals.css` for theme colors (`.dark` class). Dark mode via `class` strategy.
- Use `cn()` from `@/frontend/lib/utils` for className merging (uses `clsx` + `tailwind-merge`).

## Authentication
- **Clerk** via `@clerk/nextjs`.
- Server side: `import { auth } from "@clerk/nextjs/server"` in API routes. Returns `userId`.
- Client side: `useUser()`, `<SignInButton/>`, `<SignUpButton/>`, `<UserButton/>`.
- Middleware: `app/middleware.ts` — protects all routes via `clerkMiddleware()`.
- `GET /api/jobs/[jobId]/status` and `GET /api/jobs/[jobId]/questions` require a signed-in owner or an admin (`jobContentAccessDecision` in `lib/uploadSessionJobs.ts`). Ownership is `uploaded_by` via `callerOwnsStoredJob`. The check runs before a MongoDB payload is returned and before either route calls the AI pipeline. A stored job with no uploader, and a job that is not stored yet, are not readable by a non-admin.
- `POST /api/exam-analysis/upload-bulk-zip` requires a signed-in user. It extracts PDFs from the `zipFile` field and ingests each one through `ingestBulkExamFile`, which stores that user as `analyzedBy`. This route does not call the AI pipeline.

## AI Pipeline Communication
- Frontend API routes call the Python Flask AI pipeline via `fetchFromAiPipeline` / `withPipelineAuth` (`lib/aiPipeline.ts`).
- `AI_PIPELINE_URL` defaults to `http://127.0.0.1:5000`. `AI_PIPELINE_TOKEN` is a server-only shared secret sent as `Authorization: Bearer`. Do not use a `NEXT_PUBLIC_` variable for it.
- Job status and question proxies authorize with `jobContentAccessDecision` before calling the pipeline. Upload routes use `requireAdminCaller`. Those helpers are the user checks; the token only identifies this server to Flask.
- **Never call AWS Textract/Bedrock directly from the frontend** — always go through the AI pipeline.

## Key Packages
- `next` 15.2.4, `react` 18.3.1, `react-dom` 18.3.1
- `@clerk/nextjs` ^6.24.0
- `mongoose` ^8.19.1 (for API routes importing backend models)
- `tailwindcss` ^3.4.17, `tailwind-merge`, `tailwindcss-animate`
- `lucide-react` ^0.454.0 (icons)
- `recharts` (charts)
- `zod` ^3.25.76 (validation in API routes)
- `react-hook-form` + `@hookform/resolvers` (forms)
- `sonner` (toasts)
- `pdf-lib`, `jszip` (utilities)
