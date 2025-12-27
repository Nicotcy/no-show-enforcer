# Project rules (No-Show Enforcer / TorcellySync)

## Do not delete or rewrite features "to simplify"
- Never remove existing routes, pages, or APIs unless explicitly requested.
- Prefer small, incremental changes.

## Tech constraints
- Next.js App Router, Node runtime (no edge).
- Supabase Auth + Postgres + RLS. Service role is used ONLY inside server routes (app/api/*) when needed.
- Keep everything in English.

## Code style
- When you change a file, rewrite the full file content in the PR description (or provide a clear diff).
- Avoid introducing new dependencies unless necessary.

## Testing
- After changes, run: npm run build
- If touching API routes, also provide 2 manual test steps (curl or browser).
