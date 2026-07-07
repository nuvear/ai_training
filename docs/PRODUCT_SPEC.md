# Workshop OS — Product Specification

**Repo:** `nuvear/ai_training` · **Status:** Draft v0.1 for owner review · **Last updated:** 2026-07-07

This is a decision-oriented spec. Every section states a **default decision** the build will follow unless overridden. Items marked **⚠ OPEN** need an explicit answer from the owner before the milestone that depends on them.

---

## 1. Product summary

An AI-first web platform for running a workshop business end to end: creating and launching workshops, marketing them, selling seats to individuals and organizations, managing participants and their learning progress, and operating the business through a conversational copilot. Fully bilingual: English and Japanese (日本語) at the data, UI, and generated-content level.

**Positioning principle:** the admin describes intent; the system executes operations through auditable AI agents. The UI and the agents call the same internal API.

---

## 2. Users and roles (RBAC)

| Role | Description | Key permissions |
|---|---|---|
| **Owner** | The business operator | Everything, incl. AI approval settings, payouts, refunds |
| **Staff** | Assistants/facilitators | Manage workshops, participants, content; no financial settings |
| **Org Admin** | Client company's manager | Buy seat pools, assign employees, view their org's progress/invoices only |
| **Participant** | Individual learner or org employee | Enroll, learn, track own progress, download own certificates |
| *(implicit)* Visitor | Anonymous prospect | Browse catalog, chat with concierge, purchase |

**Decisions:**
- Multi-tenancy is at the **organization** level; individual participants belong to zero or one org.
- A participant paid for by an org sees the same experience as an individual; the difference is billing and reporting visibility.
- Org admins can see employees' **attendance, completion, quiz aggregate scores**, but not free-text reflections (privacy default). **⚠ OPEN:** confirm this privacy boundary.

---

## 3. Workshop domain model

**Lifecycle states:** `draft → published → open (booking) → full → running → completed → archived`. `cancelled` is reachable from any pre-completion state.

**Structure:**
- **Workshop** = the product (title, description, outcomes, level, materials) — all content fields stored as `{en, ja}`.
- **Cohort** = a scheduled run of a workshop (dates, capacity, price, venue/online link, facilitator).
- **Session** = one meeting within a cohort (agenda, materials, attendance record).

**Decisions:**
- Capacity and waitlist per cohort. Waitlist promotion is automatic on cancellation, ordered by AI-scored likelihood-to-attend, with FIFO fallback. Promoted people get 24h to confirm.
- Formats supported: online (Zoom/Meet link), in-person (venue), hybrid.
- Recurring cohorts are created by cloning with the copilot ("run this again in October").

---

## 4. Commerce

### 4.1 Pricing & currency
- Prices set per cohort in **JPY and USD** (explicit dual price, not FX-converted at checkout — cleaner for Japanese buyers). Display follows the visitor's locale, switchable.
- **⚠ OPEN:** default price points and whether USD is needed at launch or JPY-only.

### 4.2 Checkout paths
1. **Individual checkout (B2C):** Stripe — cards, Apple/Google Pay, Konbini. Instant confirmation.
2. **Organization purchase (B2B):** seat-pool purchase (e.g., 20 seats usable across cohorts, 12-month validity). Payment by card **or** invoice + bank transfer (請求書 + 振込). Invoices carry the qualified invoice registration number (適格請求書, インボイス制度) and 10% consumption tax. Seats activate on payment receipt; owner can manually activate earlier.
   - **⚠ OPEN:** qualified invoice issuer registration number to print on invoices.

### 4.3 Promo codes
- Types: percent-off, fixed-amount, early-bird (time-boxed), seat-limited (first N), referral.
- **Stacking: not allowed** (one code per order) — simplest to reason about and communicate.
- AI may **suggest** promo codes based on demand signals; creation always requires owner approval (see §7).

### 4.4 Refunds & cancellation policy (default)
- Full refund ≥ 7 days before cohort start; 50% within 7 days; none after start. Owner can override per case.
- Org seat pools: unused seats refundable at 80% within 90 days of purchase.
- **⚠ OPEN:** confirm or replace this policy; it will be printed on receipts and terms.

---

## 5. Learning & progress

- **Attendance** recorded per session (facilitator check-off or self check-in link; online sessions can auto-log join).
- **Completion** = attended ≥ 80% of sessions **and** passed the final quiz (≥ 70%). Defaults; configurable per workshop.
- **Quizzes** are AI-generated from the workshop's actual materials, reviewed/edited by staff before publishing.
- **Skill map:** each workshop tags 3–6 skills; participant profiles accumulate a skill graph across workshops.
- **Certificates:** bilingual PDF, auto-issued on completion, verifiable via public URL with unique ID.
- **Nudges:** AI-personalized reminders (pre-work not started, session tomorrow, quiz pending). Participants can mute.

---

## 6. Marketing & sales funnel

- Every published workshop gets a **generated landing page** per language (headline variants, outcomes, facilitator bio, social proof, FAQ, booking CTA).
- **Email sequences** (announcement → reminder → last-seats) generated per cohort; owner approves the sequence once, sends are then automatic.
- **A/B testing:** AI generates 2 landing-page variants, reallocates traffic to the winner after significance, and reports the "why" in plain language.
- **Attribution:** UTM capture, referral codes, funnel dashboard (visit → page → checkout → paid).
- Social post drafts (LinkedIn/X) generated on publish; always manual to post (no auto-posting at launch).

---

## 7. AI operating layer — behavior contract

This section is the heart of the product. Every agent action is written to the **AI Action Ledger** (who/what/when/inputs/outputs) and is inspectable and, where possible, reversible.

**Autonomy tiers (default assignment):**

| Tier | Behavior | Examples |
|---|---|---|
| **Auto** | Executes, logged, notify-after | Send scheduled reminders, promote waitlist, localize content drafts, generate reports |
| **Approve** | Prepared, executes only on owner/staff approval | Publish workshop or landing page, create promo code, send marketing campaign, issue refund ≤ ¥10,000 |
| **Owner-only** | Agent may draft/recommend, never execute | Refunds > ¥10,000, price changes, org contract changes, cancelling a cohort |

- **⚠ OPEN:** confirm tier assignments and the refund threshold.
- The copilot console supports natural language in EN or JA; multi-step commands produce a **plan preview** (list of intended actions) before anything in Approve/Owner tiers runs.
- Concierge chatbot (public) can answer questions and complete enrollment; it **cannot** apply discounts beyond published promo codes and always identifies itself as AI.

---

## 8. Internationalization

- Locales: `en`, `ja`. Every content entity stores `{en, ja}`; UI strings via i18n catalog.
- Localization engine translates *and adapts*: keigo-appropriate business email register for JA (敬語 for B2B correspondence, softer 丁寧語 for participant nudges); marketing copy adapted, not literal.
- Human-in-the-loop: JA output of the localization engine is marked "AI-localized" until a human marks it reviewed. Owner decides per item whether review is required before publish (default: required for landing pages and B2B email, not for reminders).
- Formats: dates (2026年7月7日 / July 7, 2026), currency (¥45,000 / $310), name order (family-name-first for JA), timezone default Asia/Tokyo with per-user override.
- Fonts: Noto Sans JP paired with the Latin UI face; JA line-height and density tokens defined in the design system.

---

## 9. Non-functional requirements

- **Stack:** Next.js (App Router, TypeScript), Postgres + Prisma, pgvector, background job queue, Stripe, Anthropic API, Resend (email), object storage for materials/PDFs.
- **Security:** RBAC enforced at API layer; org data isolated via row-level security; audit log for all financial and AI actions; no card data touches our servers (Stripe-hosted elements).
- **Privacy:** participant personal data visible to their org only per §2 boundary; data export and deletion on request (APPI + GDPR-style baseline).
- **Performance:** landing pages statically generated, < 1.5s LCP target; admin app can be dynamic.
- **Reliability:** payment webhooks idempotent; job queue with retries; daily DB backups.
- **Observability:** structured logs, error tracking, metric on every AI action (latency, approval rate, override rate).

---

## 10. Milestones (one-shot build, internal gates)

| Gate | Scope | Exit criteria |
|---|---|---|
| **M0 Foundation** | Auth, RBAC, bilingual data model, Stripe sandbox, agent skeleton + ledger | Copilot can execute one end-to-end toy command with approval flow |
| **M1 Workshop core** | Workshop/cohort/session CRUD, catalog, landing pages | A workshop can be authored in EN, localized to JA, and published |
| **M2 Commerce** | B2C checkout, promo engine, B2B seat pools, JP invoicing, refunds | Test purchases succeed in all payment paths incl. 振込 invoice |
| **M3 Org portal** | Seat assignment, org dashboards, invoices/POs | An org admin can buy 10 seats, assign 5 employees, download an invoice |
| **M4 Participant layer** | Progress, quizzes, certificates, concierge | A participant completes a cohort and receives a verifiable bilingual certificate |
| **M5 AI operations** | Full copilot command set, generative marketing, predictive ops, narrative analytics | The September-launch command from §7 works end to end |
| **M6 Hardening & launch** | Load/security testing, native JA review, Stripe live, observability | Go-live checklist signed off |

---

## 11. Out of scope (v1)

Mobile native apps; SCORM/LMS interoperability; affiliate payouts; auto-posting to social media; languages beyond EN/JA; marketplace for third-party facilitators.

---

## 12. Open questions summary

1. Org visibility privacy boundary (§2)
2. Launch pricing and JPY-only vs JPY+USD (§4.1)
3. Qualified invoice issuer number (§4.2)
4. Refund policy confirmation (§4.4)
5. AI autonomy tier assignments and refund threshold (§7)
