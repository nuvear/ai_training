# RUNBOOK — WorkshopOS operations

Operational procedures for running WorkshopOS in production. Audience: the owner and any operator with production access. Keep this file current — it is the source of truth for "how do I…" during an incident.

> **Golden rules.** Secrets live only in the host's environment (never in git, never in logs). Money totals are computed server-side only. No card data ever touches our servers (Airwallex-hosted checkout only). Every AI action is written to the `ai_action` ledger *before* it executes.

---

## 0. Target topology (confirm at go-live)

- **App:** Next.js (App Router) on **Vercel**.
- **Database:** managed **Postgres (Neon)** with `pgvector` + `citext` extensions, plus the non-login `workshopos_app` role that RLS policies switch to (see `prisma/migrations/*_rls_grants_guards`).
- **Jobs:** pg-boss (uses the same Postgres — no Redis required).
- **Email:** Resend (verified sending domain).
- **Payments:** Airwallex (hosted checkout + signed webhooks).
- **AI:** Anthropic API (copilot planner, localization, concierge).

> ⚠ **Owner decision required at go-live:** the spec permits substituting the deploy target. Confirm Vercel + Neon (or the chosen equivalent) before provisioning. Record the choice in `docs/DECISIONS.md`.

---

## 1. Environment variables (production checklist)

All values come from the host's env store (Vercel Project → Settings → Environment Variables). `.env.example` is the authoritative list of keys. **Every key below must be set in production before the first deploy.**

| Variable | Purpose | Notes |
|---|---|---|
| `DATABASE_URL` | Pooled Postgres connection (app runtime) | Neon pooled endpoint; RLS depends on the `workshopos_app` role existing — run migrations first |
| `DIRECT_URL` | Direct (unpooled) Postgres | Used by `prisma migrate` |
| `APP_URL` | Public base URL | e.g. `https://app.workshopos.com`; used to build checkout return + verify URLs |
| `AUTH_SECRET` | Magic-link JWT signing secret | 32+ random bytes; rotating it invalidates all sessions |
| `ANTHROPIC_API_KEY` | Copilot / concierge / localization | Unset ⇒ deterministic offline stubs (safe but non-generative) |
| `AIRWALLEX_API_KEY` | Airwallex REST auth | **Live** key at go-live; sandbox before |
| `AIRWALLEX_CLIENT_ID` | Airwallex client id | Live vs sandbox must match the API key's mode |
| `AIRWALLEX_WEBHOOK_SECRET` | Webhook HMAC verification | From the Airwallex webhook config; per-endpoint |
| `AIRWALLEX_ENV` | `demo` \| `prod` | Selects sandbox vs live base URL |
| `RESEND_API_KEY` | Transactional email | Unset ⇒ emails logged, not sent |
| `RESEND_FROM` | Verified From address | Domain must pass SPF/DKIM in Resend |
| `SENTRY_DSN` | Error tracking (optional) | Unset ⇒ `captureError` logs structured JSON only |

**Verify before deploy:** no key is committed (`git ls-files | grep -E '(^|/)\.env'` returns nothing), and `pnpm audit --prod` has been reviewed (see §9).

---

## 2. Deploy

### First production deploy
1. Provision Neon; create the database. Set `DATABASE_URL` + `DIRECT_URL`.
2. Apply the schema and RLS policies (they include creating the `workshopos_app` role and grants):
   ```
   pnpm prisma migrate deploy      # NEVER `migrate reset` in production
   ```
3. (Optional, first launch only) seed reference/catalog data if desired: `pnpm db:seed`. **Do not** run the seed against a database that already holds real orders.
4. Set all env vars from §1 in Vercel.
5. Deploy: push to the production branch (Vercel builds `pnpm build`) or `vercel --prod`.
6. Smoke test §8.

### Routine deploy
1. Merge to the production branch → Vercel auto-builds.
2. If the change includes a migration, `pnpm prisma migrate deploy` runs against production **before** the new code serves traffic (Vercel build step or a manual pre-deploy). Migrations must be backward-compatible with the currently-running version (expand/contract).
3. Watch the metrics endpoint (§7) and error logs for 5–10 min.

### Rollback
- **Code:** redeploy the previous Vercel deployment (instant, immutable).
- **Schema:** never auto-rollback a migration. If a migration is bad, roll forward with a corrective migration. Restore from backup (§4) only as a last resort.

---

## 3. Rotate keys / secrets

Rotate on suspected exposure, on operator offboarding, and on a routine cadence (quarterly). One secret at a time; verify after each.

- **`AUTH_SECRET`** — generate 32+ random bytes, update the env var, redeploy. Effect: all existing magic-link sessions are invalidated; users re-authenticate. No data change.
- **`ANTHROPIC_API_KEY`** — issue a new key in the Anthropic Console, update env, redeploy, then revoke the old key. Zero downtime (stateless).
- **`AIRWALLEX_API_KEY` / `AIRWALLEX_CLIENT_ID`** — create new credentials in Airwallex, update env, redeploy, verify a sandbox (or small live) payment, then revoke the old. Keep API key and client id in the same mode.
- **`AIRWALLEX_WEBHOOK_SECRET`** — rotate the webhook signing secret in Airwallex, update env, redeploy. Because webhook verification is HMAC over `x-timestamp + rawBody`, an in-flight webhook signed with the old secret will fail verification and Airwallex will retry — brief mismatch window is acceptable; keep it short.
- **`RESEND_API_KEY`** — new key in Resend, update env, redeploy, revoke old.
- **`DATABASE_URL` / `DIRECT_URL`** — rotate the DB password in Neon, update both env vars, redeploy. Expect a few seconds of connection errors as pools recycle.

**Never** print a secret to logs or paste it into chat/issues. If a secret was exposed in a commit, rotate it *and* purge history.

---

## 4. Backup & restore

- **Backups:** Neon provides continuous backup + point-in-time restore (PITR). Confirm the retention window meets the recovery objective; if using another Postgres, schedule `pg_dump` (daily full + WAL archiving) to object storage.
- **Restore drill (staging):** restore the latest backup into a fresh Neon branch, point a staging deploy at it, run the smoke test (§8). Do this at least once before go-live and quarterly after.
- **Production restore:**
  1. Put the app in maintenance (pause the Vercel deployment or set a maintenance flag) to stop writes.
  2. PITR to the chosen timestamp (Neon Console) → this creates a new branch/endpoint.
  3. Repoint `DATABASE_URL`/`DIRECT_URL` at the restored endpoint; redeploy.
  4. Reconcile payments (§5) — orders paid between the restore point and the incident may need to be re-applied from Airwallex, since the webhook is idempotent on `provider_ref` and can be safely re-delivered.
  5. Smoke test (§8), then lift maintenance.

---

## 5. Reconcile bank transfer / Airwallex settlement

Money is authoritative in the ledgered `Order` + `Payment` rows; Airwallex is the settlement source of truth. Reconcile at least weekly and after any incident.

1. Export the Airwallex settlement report for the period (Airwallex Dashboard → Balances/Settlements).
2. For each settled payment, confirm a matching `Payment` row exists (`provider_ref` = Airwallex payment intent id) and its `Order.status = paid`.
3. **Missing order (payment settled, no paid order):** the webhook was missed. Re-deliver the webhook from Airwallex (Dashboard → Webhooks → resend) — our handler is idempotent on `provider_ref`, so re-delivery is safe and will finalize the order + enrollment + receipt. If re-delivery isn't possible, use the reconcile path in the ops console (or a one-off script) to mark the order paid *by verifying against the Airwallex API*, never by trusting client input.
4. **Extra order (paid order, no settlement):** likely a sandbox/live mode mix-up or a refund in flight — investigate before touching data.
5. **Bank transfer / offline payments (e.g. Konbini):** these settle asynchronously. Match the incoming transfer reference to the pending order and confirm via the Airwallex API before flipping status. (The Konbini voucher/QR PDF flow is a known deferred item — see `docs/DECISIONS.md`.)
6. Consumption tax: JPY orders carry 10% tax computed server-side. Reconciliation checks the stored `Order.total` (never recompute at reconcile time).

---

## 6. Airwallex webhook backlog

Symptoms: orders stuck in `pending_payment` while customers report paying; a spike in webhook retries.

1. **Check reception:** look for `POST /api/webhooks/airwallex` in the app logs. 401/403 ⇒ signature failures (wrong `AIRWALLEX_WEBHOOK_SECRET` or clock skew on `x-timestamp`). 5xx ⇒ handler error (check `captureError` output).
2. **Signature failures:** confirm the webhook secret matches the endpoint's current secret in Airwallex; if it was just rotated (§3), let Airwallex retries catch up.
3. **Handler errors:** fix forward, redeploy. Airwallex retries failed deliveries with backoff, so a fixed handler will drain the backlog automatically. Because the handler is idempotent on `provider_ref`, replays are safe.
4. **Manual drain:** for events beyond the retry window, re-send them from the Airwallex Dashboard (Webhooks → event → resend). Verify each resulting order finalized.
5. **Confirm drained:** the AI/ops metrics + a query for `Order.status='pending_payment'` older than ~1h with a settled Airwallex payment should return zero.

---

## 7. Observability

- **Structured logs:** JSON via `src/server/observability/logger.ts` (`log.info/warn/error`). Searchable in the Vercel/host log drain.
- **Error tracking:** `captureError` (wired into the HTTP 500 path) emits structured error JSON and forwards to Sentry when `SENTRY_DSN` is set.
- **AI-layer metrics:** `GET /api/admin/metrics` (staff/owner only) returns the ledger-derived dashboard — total AI actions, counts by tier + status, **approval rate**, **override (rejection) rate**, **auto-execution share**, and action **latency**. Watch for: override rate climbing (the AI is proposing things operators reject — investigate the prompts/tiers), or latency spikes (Anthropic degradation).
- **Health:** the app's public surfaces (catalog, landing) should return 200 in both locales; the smoke test (§8) is the canonical check.

---

## 8. Smoke test (post-deploy / post-restore)

Run after every production deploy and every restore. All must pass:

1. **Catalog loads, both locales:** `GET /en` and `GET /ja` → 200, content present, no raw i18n keys.
2. **Auth:** request a magic link (`POST /api/auth/magic-link`), follow the callback, land authenticated.
3. **Copilot (staff):** the launch command returns a plan; auto steps run, approve steps queue. (See `e2e/copilot-flow.spec.ts`.)
4. **Checkout (sandbox first):** a B2C checkout reaches Airwallex-hosted checkout; a test payment → signed webhook → `Order.status=paid` + enrollment active + bilingual receipt. **This was proven end-to-end in the Airwallex sandbox during M2.**
5. **Metrics:** `GET /api/admin/metrics` returns as staff, 403 as anyone else.
6. **Rate limiting:** hammering a public endpoint past its limit returns 429 with `Retry-After`.
7. **Privacy boundary:** an org admin sees aggregates only — never another participant's free-text reflections, never another org's rows.

---

## 9. Security posture

- **RBAC + RLS:** four roles; org data isolated by row-level security switching to `workshopos_app` with per-request GUCs. The **authz matrix test** (`tests/authz-matrix.test.ts`) enforces *zero unexpected allows* across every tool × role — keep it green.
- **Tier enforcement is server-side:** every copilot tool's tier lives in the server registry; model output can never escalate it; every call writes an `ai_action` row before executing.
- **Untrusted content is data:** participant input, feedback, and rendered Markdown are never interpreted as instructions by any agent; the public concierge uses only the restricted tool subset.
- **Rate limiting** on public endpoints (magic-link, concierge, verify, check-in) — in-memory per instance today; move to a pg/Redis store if scaling beyond one instance.
- **Dependency audit:** run `pnpm audit --prod` each release. **Known accepted risk:** `next-intl` 3.26.x moderate advisories (prototype pollution via `experimental.messages.precompile`) — the vulnerable path is unused and catalogs are first-party static JSON, so it is unreachable in our config. **Post-launch item #1:** upgrade `next-intl` to 4.9.2+ (a 3→4 major upgrade; test routing/config changes on staging). See `docs/DECISIONS.md`.
- **Secrets:** env-only; scan tracked files before each release; `.env` is gitignored and untracked.

---

## 10. Airwallex live-mode cutover (executed by the owner)

Do this once, at go-live, after the sandbox smoke test passes. **The owner performs the live steps; do not use live keys in dev/CI.**

1. Complete Airwallex account activation + KYC; obtain the **適格請求書 (qualified invoice) registration number** and set it wherever invoices render the issuer number.
2. In Airwallex **live** mode, create API credentials → set `AIRWALLEX_API_KEY`, `AIRWALLEX_CLIENT_ID` in production, and `AIRWALLEX_ENV=prod`.
3. Configure the **live** webhook endpoint (`{APP_URL}/api/webhooks/airwallex`), copy its signing secret → `AIRWALLEX_WEBHOOK_SECRET`. Enable the payment-intent succeeded/failed events.
4. Redeploy.
5. **Live verification:** run one real, low-value live payment end-to-end; confirm the signed webhook finalizes the order + enrollment + receipt; then refund it and confirm the refund path. Reconcile it in the next settlement (§5).
6. Record the cutover date + the invoice registration number in `docs/DECISIONS.md`.

---

## 11. Go-live checklist (owner sign-off)

Launch only when every box is checked. Sign at the bottom.

**Infrastructure**
- [ ] Deploy target confirmed (Vercel + Neon or approved substitute) and recorded in DECISIONS.
- [ ] All production env vars set (§1); no secret in git; `pnpm audit --prod` reviewed (§9).
- [ ] `prisma migrate deploy` applied; RLS role/policies present.
- [ ] Backup + PITR confirmed; one restore drill completed (§4).

**Payments (owner)**
- [ ] Airwallex live cutover complete (§10): live keys, live webhook, `AIRWALLEX_ENV=prod`.
- [ ] 適格請求書 registration number set and shown on invoices.
- [ ] One live payment + refund verified end-to-end and reconciled (§5, §8.4).

**Email**
- [ ] Resend domain verified (SPF/DKIM pass); `RESEND_FROM` set; a live test email delivered.

**Quality gates**
- [ ] Full test suite green (`pnpm test` + `pnpm e2e`); **authz matrix has zero unexpected allows**.
- [ ] Staging deploy reachable in **both locales**; all six mock-screen surfaces implemented and token-faithful.
- [ ] Japanese sweep signed off (native-quality; copilot + concierge self-identify as AI).
- [ ] Founder katakana ラジクマール・ラジャゴバラン confirmed by owner (done — DECISIONS 2026-07-07).
- [ ] Smoke test (§8) passes against production.

**Operational readiness**
- [ ] Metrics endpoint reachable; error tracking (Sentry DSN) live or consciously deferred.
- [ ] Rate limiting verified on public endpoints.
- [ ] This runbook reviewed; on-call/escalation path agreed.

---

**Owner sign-off:** ______________________  **Date:** ____________

_Post-launch item #1: upgrade next-intl to 4.9.2+ (see §9)._
