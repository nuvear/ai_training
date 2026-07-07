# Decision log

Append-only. Agents record any interpretation made where docs were ambiguous.

| Date | Decision | Made by | Rationale / doc reference |
|---|---|---|---|
| 2026-07-07 | Hosting default set to Vercel + Neon pending owner confirmation | design session | tasks/M6.md |
| 2026-07-08 | Auth = custom email magic-link (token table + signed JWT session cookie via `jose`), not Auth.js. In dev the magic link is logged to the server console; Resend sends it when `RESEND_API_KEY` is set. | M0 build | tasks/M0.md §3 — full control, e2e-testable without a live mail server, one fewer heavy dependency |
| 2026-07-08 | RLS enforcement pattern: app connects to Postgres as a superuser role for simplicity, but every tenant query runs inside a transaction that does `SET LOCAL ROLE workshopos_app` (a NOLOGIN, non-superuser role) plus `set_config('app.current_*', …, true)`; RLS policies read those GUCs. `owner`/`staff` are global (see all orgs); `org_admin`/`participant` are org-scoped. | M0 build | CLAUDE.md invariant 8, DATA_MODEL §2 — proves org isolation without dual DATABASE_URLs; superuser bypasses RLS, but `SET LOCAL ROLE` to a non-superuser re-subjects the session to it |
| 2026-07-08 | Job queue = pg-boss (Postgres-backed), taking the "avoid Redis" option in CLAUDE.md. Uses `DIRECT_URL` (superuser) so it can create its `pgboss` schema. | M0 build | CLAUDE.md stack line, tasks/M0.md §8 |
| 2026-07-08 | Dev database = Docker Compose `pgvector/pgvector:pg16` on port 5433 (`pnpm db:up`), so a fresh clone reproduces the exact DB with pgvector + citext regardless of the host's Postgres. `pnpm db:migrate` brings it up first. | M0 build | tasks/M0.md exit criteria — reproducible "fresh clone" path |
| 2026-07-08 | i18n routing = next-intl with a `[locale]` path segment (`/en/…`, `/ja/…`); the locale switcher swaps the segment while preserving the rest of the path + search params. | M0 build | tasks/M0.md §4, DESIGN §4 |
