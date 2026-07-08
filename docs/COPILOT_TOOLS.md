# Workshop OS — Copilot Tool Schema

**Status:** Draft v0.1 · pairs with `PRODUCT_SPEC.md` §7 and `DATA_MODEL.md` · This document is the API contract: every tool below maps 1:1 to an internal API endpoint used by both the UI and the agents.

Conventions:
- Tool names are `domain.verb_object`.
- **Tier** column uses the autonomy tiers from spec §7: `auto` (execute + log), `approve` (staff/owner approval required), `owner` (owner approval required). Tier is enforced server-side per tool — the model cannot escalate its own permissions.
- Every call writes an `ai_action` row before execution; `approve`/`owner` calls sit in status `proposed` until acted on.
- All content-producing tools accept a `locales` param (`["en","ja"]` default) and return both variants.
- Multi-step commands: the orchestrator first emits a `plan` (ordered list of tool calls) shown as a preview; the plan itself is an `ai_action` parent row.

---

## 1. Workshop lifecycle

| Tool | Params (abridged) | Tier | Notes |
|---|---|---|---|
| `workshop.create` | title, summary, outcomes, level, skills[] | auto | creates in `draft` |
| `workshop.update` | workshop_id, patch | auto | drafts only; published requires `approve` |
| `workshop.publish` | workshop_id | approve | validates both locales present |
| `workshop.archive` | workshop_id | approve | |
| `cohort.create` | workshop_id, dates, capacity, price_jpy, price_usd?, format, venue?, facilitator_id | approve | pricing makes this approve-tier |
| `cohort.clone` | cohort_id, new_dates | approve | "run it again in October" |
| `cohort.cancel` | cohort_id, reason | owner | triggers refund plan proposal |
| `session.update_agenda` | session_id, agenda | auto | |
| `waitlist.promote` | cohort_id, n? | auto | AI-scored order, 24h confirm window |

## 2. Content & localization

| Tool | Params | Tier | Notes |
|---|---|---|---|
| `content.generate` | workshop_id, kind (`description`,`outcomes`,`faq`,`bio`) | auto | drafts only |
| `content.localize` | entity_type, entity_id, target_locale, register (`keigo_b2b`,`polite`,`casual`) | auto | output flagged `ai_localized` |
| `content.mark_reviewed` | entity_type, entity_id, locale | approve | human attestation |
| `quiz.generate` | workshop_id, n_questions, difficulty | auto | lands as `ai_draft` |
| `quiz.publish` | quiz_id | approve | staff review gate |

## 3. Marketing & sales

| Tool | Params | Tier | Notes |
|---|---|---|---|
| `landing.generate_variants` | workshop_id, locale, n=2 | auto | drafts |
| `landing.publish` | landing_page_id | approve | |
| `landing.reallocate_traffic` | workshop_id, weights | auto | post-significance only; logs the evidence |
| `campaign.draft_sequence` | cohort_id, kind | auto | |
| `campaign.approve_and_schedule` | campaign_id | approve | one approval covers the sequence |
| `promo.suggest` | cohort_id, objective (`fill_seats`,`early_bird`,`referral`) | auto | returns proposals only |
| `promo.create` | code, type, value, scope, limits | approve | |
| `promo.deactivate` | promo_code_id, reason | auto | safety valve; logged with evidence |
| `social.draft_posts` | cohort_id, channels[] | auto | never auto-posts (spec §6) |

## 4. Commerce & finance

| Tool | Params | Tier | Notes |
|---|---|---|---|
| `order.lookup` | query (nl or id) | auto | read-only |
| `order.resend_receipt` | order_id | auto | |
| `invoice.issue` | order_id | approve | generates 請求書 PDF, sequential number |
| `invoice.mark_paid` | invoice_id, payment_ref | approve | bank-transfer reconciliation |
| `refund.execute` | payment_id, amount, reason | approve ≤ ¥10,000 / owner above | threshold from spec §7 ⚠ |
| `pricing.change` | cohort_id, new_prices | owner | |
| `seatpool.create_offer` | organization_id, seats, price, validity | owner | B2B contract terms |

## 5. Organizations & participants

| Tool | Params | Tier | Notes |
|---|---|---|---|
| `org.create` | name, billing_email, billing_method | approve | |
| `org.assign_seats` | seat_pool_id, user_emails[] | auto | invites employees; consumes seats on enrollment |
| `participant.enroll` | user_id, cohort_id, source | auto if seat/paid; approve if `comp` | |
| `participant.search` | query (semantic) | auto | pgvector-backed; respects RBAC scope |
| `nudge.send` | enrollment_id, kind | auto | respects mute prefs |
| `certificate.issue` | enrollment_id | auto | fires on completion rule; manual re-issue allowed |
| `attendance.record` | session_id, entries[] | auto | facilitator surface |

## 6. Analytics & intelligence

| Tool | Params | Tier | Notes |
|---|---|---|---|
| `analytics.query` | question (natural language), timeframe? | auto | read-only SQL over a safelisted semantic layer — never raw SQL from the model |
| `analytics.explain_change` | metric, period | auto | "why did June dip" — returns narrative + evidence rows |
| `report.org_progress` | organization_id, period, locale | auto | generated PDF/HTML, keigo register for JA |
| `predict.no_shows` | cohort_id | auto | scores feed reminder escalation |
| `predict.demand` | workshop_id | auto | feeds `promo.suggest` |
| `feedback.cluster` | cohort_id | auto | themes + sentiment written back to rows |

## 7. Concierge surface (public chatbot) — restricted subset

The concierge runs with a *separate, narrower* tool set and an anonymous-or-participant identity. It can never see other users' data.

| Tool | Tier | Notes |
|---|---|---|
| `catalog.search` | auto | published workshops only |
| `cohort.availability` | auto | seats left, dates, price |
| `enrollment.begin_checkout` | auto | hands off to Airwallex-hosted checkout; concierge never touches payment data |
| `promo.validate` | auto | can confirm a published code; cannot create or extend discounts |
| `faq.answer` | auto | RAG over approved content only; must self-identify as AI |
| `handoff.to_human` | auto | opens a ticket for the owner |

## 8. Cross-cutting rules

1. **Server-side tier enforcement.** The tier lives in the tool registry on the server. Agent context never contains credentials or tier-override capability.
2. **Plan preview.** Any command expanding to ≥ 2 write-tools, or containing any `approve`/`owner` tool, produces a plan preview first.
3. **Idempotency.** Every write-tool takes a client-generated `idempotency_key`; retries are safe.
4. **Rollback.** Tools declare a `reverse_of` where meaningful (e.g., `landing.publish` ↔ retire). The ledger links reversals.
5. **Injection defense.** Content originating from participants, feedback, or the public web is treated as data: it is never interpreted as instructions by any agent, and concierge inputs cannot trigger tools outside §7's subset.
6. **Locale integrity.** No entity can leave draft status unless both `en` and `ja` variants exist (validated at the tool layer, not just the UI).
7. **Observability.** Every call records latency, token cost, tier, approval latency, and human-override rate — these are the KPIs of the AI layer itself.
