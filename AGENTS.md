# AGENTS.md

MusorBox — educational mobile portal (2013-era "wap" aesthetic), Russian content, built on **Bun + Hono (JSX) + Drizzle ORM over bun:sqlite**, with a self-hosted ActivityPub federation layer.

## Commands

Verification is `bun run typecheck` (`tsc --noEmit`) — **there is no test suite, no linter, and no CI.** Run typecheck after every change.

- `bun run dev` — watch-mode server, http://localhost:3000 (`bun run --watch src/app.tsx`)
- `bun run start` — no watch mode
- `bun run db:generate` — new Drizzle migration from `src/core/schema.ts` (single schema file); `db:push` — sync schema directly to DB
- `bun run seed` — **destructive**: deletes users/topics/comments/votes/sessions/categories/tags/firms, then re-seeds demo data. Re-runs `categorySeedCount` etc. Use `bun run seed:structure` to reseed only categories/tags/topic_tags.
- `bun run ap:wipe` — destructive ActivityPub cleanup that sends signed `Delete` activities to remote inboxes and can wipe the local DB (`--yes`, `--force-wipe`); reads `PUBLIC_BASE_URL` and actor keys from the DB.

## Database gotchas

- **Migrations auto-apply on startup**: `getDb()` in `src/core/db.ts` runs `migrate()` from `./drizzle` the first time the DB is opened (which happens at module load in `src/app.tsx`). A plain `bun run dev` creates + migrates the SQLite file; you generally don't need `db:migrate`.
- DB lives at `DB_PATH` (default `./musorbox.db`); `drizzle.config.ts` reads the same env. `*.db`, `*.db-wal`, `*.db-shm` are gitignored — never commit DB files.
- Use the singleton via `getDrizzle()` / `getDb()` from `src/core/db.ts`; never open your own connection.

## Conventions

- `tsconfig.json`: `strict`, **`verbatimModuleSyntax: true`** → type-only imports must be `import type { ... }`. `jsxImportSource: "hono/jsx"`.
- Files rendering JSX are `.tsx` (e.g. `src/topics/routes.tsx`, `forum/routes.tsx`); JS-only route modules stay `.ts` (e.g. `activitypub/routes.ts`).
- Feature layout: each domain (`auth`, `topics`, `forum`, `comments`, `votes`, `users`, `editor`, `pages`, `layout`, `sidebar`, `activitypub`) has `routes.(ts|tsx)` + `service.ts` + `components.(ts|tsx)`, all mounted at root in `src/app.tsx`. New sub-apps should be `new Hono({ strict: false })` and registered there; static assets are served from `./public`.
- Relative imports are extensionless.
- Env (`PORT`, `DB_PATH`, `SESSION_SECRET`, `PUBLIC_BASE_URL`, `AP_ALLOW_INSECURE_HOSTS`, ...) is read once at import time in `src/core/config.ts`; changing env after start has no effect.
- User-facing strings, comments, and log messages are in **Russian**; commit messages are in **English** (`scope: subject`, e.g. `activitypub: ...`).

## Assets & ActivityPub

- `public/` and `dumps/` are gitignored (site assets and archived pages extracted from the original site are not in the repo). A fresh clone runs but is unstyled until assets are placed in `public/`. Don't "fix" this by committing them.
- For federation, `PUBLIC_BASE_URL` must be the externally reachable URL (default `http://localhost:3000`). `AP_ALLOW_INSECURE_HOSTS` (default loopback) permits plain-http fetches of remote actors for local dev; set it to an explicit value to control this.
- Inbox events log to stderr with `[ap:inbox]` prefix; `AP_DEBUG=1` also appends a verbose log to `/tmp/ap-inbox-debug.log`.
- Local actors' signing keys live in the DB (`ap_keys`). Wiping the DB (e.g. via `ap:wipe`) permanently loses the ability to send federated Deletes.