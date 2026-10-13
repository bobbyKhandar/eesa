// Restores the frontend lint setup Next.js used before the monorepo move.
// The repo-root flat config is for other packages and turns Prettier into an
// error; this file is what `next lint` and `next build` pick up first.
module.exports = {
  extends: ["next/core-web-vitals"],
}
