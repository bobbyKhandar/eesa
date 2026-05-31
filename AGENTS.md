# Agent Instructions

## Code Architecture

- Strictly follow a **modular monolithic** approach. All code lives in a single deployable unit (no microservices, no separate servers). Packages within the project (`packages/backend/`, `packages/frontend/`, `packages/ai-pipeline/`) are logically separated by concern but remain in one codebase.
- Keep packages loosely coupled: each package imports across the repo via the `@/` path alias but should not depend on internal implementation details of sibling packages. Reference `context.md` at the repo root for authoritative global rules.

## Commit & Push Discipline

- Commit **and push** immediately after completing any feature, section, or logical unit of work.
- A single commit should represent one self-contained change (e.g., "add hierarchical chunker", "wire ingest queue", "implement vector store").
- Do not batch multiple unrelated features into one commit.
- Push to `origin main` after every commit unless told otherwise.
- If a push is rejected or you discover an error in the last commit, **squash the fix into that commit** (e.g., `git reset --soft HEAD~2 && git commit -m "..." && git push --force`) rather than pushing a separate follow-up fix commit. This keeps history clean.
- Use conventional commit prefixes: `feat:`, `fix:`, `test:`, `docs:`, `refactor:`, `chore:`.

## Documentation

- Update `README.md` with every execution if anything mentioned in `README.md` was changed.
- When adding or significantly updating a feature, review all `.md` files in the project (`README.md`, `context.md`, and any package-level documentation) and update them if they reference the changed functionality.

## Testing

- Every feature must have tests. Run the full test suite before committing.
- Keep existing tests passing.
