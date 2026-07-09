# WorkshopOS

An AI-first, bilingual (EN/JA) platform for running a workshop business — built under human approval. See [`CLAUDE.md`](CLAUDE.md) for the build constitution and [`docs/`](docs/) for the source-of-truth specs.

**Milestone status:** M0 (Foundation) ✅ — a running skeleton where one toy copilot command executes end-to-end through the approval flow.

## Stack

Next.js (App Router, TS strict) · Postgres + Prisma + pgvector · next-intl (EN/JA) · pg-boss job queue · custom email magic-link auth · Vitest + Playwright.

## Prerequisites

- Node ≥ 20, pnpm ≥ 9
- Docker (for the dev Postgres — `pgvector/pgvector:pg16`)

## Getting started (fresh clone)

```bash
cp .env.example .env      # the dev defaults work as-is
pnpm i                    # installs deps + generates the Prisma client
pnpm db:migrate           # starts the Docker DB and applies migrations
pnpm db:seed              # owner/staff + two orgs (optional, for the copilot demo)
pnpm dev                  # http://localhost:3000
```

`.env` is the only file you fill in. `pnpm db:migrate` brings the database up (Docker) before migrating, so no separate DB step is needed. Sign in from `/en/signin`: with no `RESEND_API_KEY` set, the one-time magic link is printed to the server console (and returned to the sign-in form as a dev link) — no mail server required.

## Scripts

| Script | Does |
|---|---|
| `pnpm dev` / `build` / `start` | Next.js dev / production build / serve |
| `pnpm db:up` / `db:down` | Start / stop the Docker Postgres |
| `pnpm db:migrate` | Bring DB up, then `prisma migrate deploy` |
| `pnpm db:seed` | Seed dev fixtures |
| `pnpm test` | Vitest (unit + DB integration) |
| `pnpm e2e` | Playwright (prepares DB, builds, runs) |
| `pnpm lint` / `format` / `typecheck` | Quality gates |

## Architecture notes (M0)

- **Bilingual by construction** — content fields are `{ en, ja }`; the publish gate lives in `src/server/ai/i18n-content.ts` and is validated at the tool layer, not just the UI.
- **AI ledger + tiers** — every copilot tool call writes an `ai_action` row _before_ execution. Tier (`auto`/`approve`/`owner_only`) is server-side in the registry (`src/server/ai/registry.ts`); model output can never escalate it. `approve`-tier tools wait in the approval queue.
- **RLS org isolation** — tenant queries run through `withOrgContext()` (`src/server/db/rls.ts`), which `SET LOCAL ROLE`s to a non-superuser role so the RLS policies apply. `owner`/`staff` are global; `org_admin`/`participant` are org-scoped.
- **Design tokens** — `src/app/globals.css` ports `DESIGN_GUIDELINES.md` §3–§6 (the 藍 palette, IBM Plex Sans JP / Shippori Mincho / Plex Mono, the tategaki signature label, tier badges). No new hues.

Interpretation choices made during the build are logged in [`docs/DECISIONS.md`](docs/DECISIONS.md).
