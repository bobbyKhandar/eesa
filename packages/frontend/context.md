# Frontend Domain Rules — Next.js 15

## Component Hierarchy
- **UI primitives** live in `components/ui/` (45 shadcn/ui components — button, card, dialog, etc.). Import from `@/frontend/components/ui/<name>`.
- **Feature components** live in `components/features/<domain>/`. Always use barrel exports via `index.ts`. Existing domains: `admin/`, `exams/`, `resources/`, `upload/`.
- **Layout shell** is split: `app/layout.tsx` (Server Component — wraps ClerkProvider + ClientLayout) and `app/clientLayout.tsx` ("use client" — sidebar, top nav, mobile toggle).

## Pages & Data Fetching
- **All pages are Client Components ("use client")** except the root `app/page.tsx` (landing page), `app/layout.tsx`, and the thin server-side guards (`app/dashboard/layout.tsx`). The entire app uses `useEffect` + `fetch()` for data fetching. **Do not write React Server Components with `async function`** for pages — that pattern is not used here.
- **Pure derivations belong in `lib/`.** `lib/dashboardMetrics.ts` holds the dashboard's score/dedupe/recency/search maths so it can be unit tested without React. Keep new view logic out of `.tsx` files when it can be a plain function.
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
- Server side: `import { auth } from "@clerk/nextjs/server"` in API routes. Returns `userId`. Use `currentUser()` when the Clerk profile (email, name) is needed.
- Client side: `useUser()`, `<SignInButton/>`, `<SignUpButton/>`, `<UserButton/>`.
- Middleware lives at `packages/frontend/middleware.ts` (**not** `app/middleware.ts`) and passes a handler to `clerkMiddleware()`. A handler-less `clerkMiddleware()` only attaches the auth context and protects nothing.
- Protected matcher: `createRouteMatcher(['/dashboard(.*)', '/api/users(.*)'])`. Page requests get a 302 to `/sign-in?redirect_url=…`; `/api/**` requests get a `401` JSON body, because a redirect is not a usable answer for a fetch.
- `app/dashboard/layout.tsx` re-checks the session server-side for the whole segment. `app/sign-in/[[...sign-in]]/page.tsx` and `app/sign-up/[[...sign-up]]/page.tsx` use `routing="path"` and are the redirect target — removing them makes the guard 404.

### Auth rules
- **Identity comes from the session, never the request body.** A handler that accepts an `email` or `user.id` from the payload must verify it resolves to the caller (or the caller is an admin).
- **Roles are server-side.** Self-service provisioning always stores `student` (`resolveProvisionedRole` in `packages/backend/src/services/userProvisioning.ts`); an existing role is preserved so an admin promotion is not reset on the next dashboard load.
- **One provisioning path.** `buildUserProfile()` + `UserRepository.upsertByClerkId()` are the only way a local user record is written. Do not add a `findById`-then-`create` pair.
- `upsertByClerkId` splits the update: `$set` for Clerk-owned fields (`email`, `name`, `lastLogin`), `$setOnInsert` for `role`, the exam arrays and `createdAt`. `_id` is excluded from both.
- **API URLs are absolute** — `"/api/..."`. `"api/..."` resolves against the current route segment and 404s off the root route.
- **Reset client state on session change.** Wait for `isLoaded`, clear state when the user is gone, and abort in-flight requests in the effect cleanup.
- **Route params in Client Components come from `useParams()`.** Next 15 passes `params` as a promise; reading it synchronously yields `undefined`.
- `GET /api/users/userInfo` returns `404` when the record is not provisioned yet — that is the dashboard's trigger for `POST /api/users/create`, not an error.
- Never nest a Clerk `<SignInButton>`/`<SignUpButton>` inside a `<Link>`; the nested interactive elements swallow the click. Use `forceRedirectUrl` so Clerk knows where to send the user.

## AI Pipeline Communication
- Frontend API routes call the Python Flask AI pipeline via `fetch(AI_PIPELINE_URL + "/endpoint")`.
- `AI_PIPELINE_URL` defaults to `http://127.0.0.1:5000` (set in `.env.local`). Also seen as `http://192.168.1.105:5000` or `http://localhost:5000`.
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
