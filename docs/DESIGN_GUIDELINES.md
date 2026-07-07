# Workshop OS — Brand & Design Guidelines

**Status:** Draft v0.1 · Reference: [muuuuu.org](https://muuuuu.org/) design gallery · pairs with `PRODUCT_SPEC.md` §8

---

## 1. Reference analysis: what we take from muuuuu.org

MUUUUU.ORG curates award-level Japanese web design daily. Its own category taxonomy names the qualities that recur across its featured sites, and these become our design vocabulary:

| Gallery tendency | Japanese term | How Workshop OS applies it |
|---|---|---|
| Generous whitespace | 余白 (yohaku) | Space is the primary layout tool; density is earned, never default |
| Hairline rules as structure | 罫線 / ライン | 1px keylines organize content instead of boxes, shadows, and heavy cards |
| Vertical text accents | 縦書き (tategaki) | Vertical section labels are our **brand signature** (see §5) |
| Refined typesetting | 洗練された文字組み | Type does the branding; decoration is minimal |
| Single impactful accent color | アクセントカラー | One brand color, used sparingly and precisely |
| Subtle, fine-grained motion | 印象的・細やかな動き | 200ms fades and reveals; nothing bounces, nothing spins |
| Grid discipline | グリッド | 8px base grid, 12-column layout |

We take *principles*, never any specific site's design.

### 1.1 Second reference: JR East Summer Internship (recruit.jreast.co.jp) — and the register decision

The owner proposed the JR East internship site as an additional reference. **Decision: adopt its page architecture for public landing pages only; keep the calm muuuuu-derived register for the application itself.** One design system, two registers:

| | **Calm register** | **Campaign register** |
|---|---|---|
| Where | Admin console, copilot, org portal, participant dashboard, checkout | Public workshop landing pages, catalog hero |
| Feel | Whitespace, hairlines, quiet precision | Emotional headline, momentum, repeated CTA |
| Shared | Same tokens, same 藍 accent, same type system, same tategaki signature | ← identical |

What the campaign register borrows from the JR East page is its **skeleton, not its visuals**: (1) an emotional hero statement set large in Shippori Mincho; (2) numbered sections with English markers + Japanese subtitles (OUTLINE / COURSE / FLOW); (3) participant testimonial quotes as social proof; (4) program logistics in definition-list form (dates, capacity, format, price — the 募集人数／実施期間 pattern); (5) an enrollment flow shown as 3 steps; (6) the CTA repeated after every major section. Rationale: checkout and daily tools must lower the pulse; a sales page must raise it. Both can share one identity because color, type, and the tategaki signature stay constant.

## 2. Brand concept

**Name (working):** Workshop OS
**Concept word:** 藍 (ai) — Japanese indigo. The pun is the brand: *ai* is both the traditional dye color and "AI." Indigo is a working craft color in Japan — the color of workwear, of things made carefully by hand — which is exactly the posture of an AI that does careful work under human approval.

**Personality:** calm, precise, quietly confident. The product never shouts; the copilot speaks like a competent colleague, not a mascot.

**Wordmark (approved):** `WorkshopOS` — set as one word, "Workshop" in `--ink` and "OS" in `--ai-600`, Shippori Mincho SemiBold, with the small 藍 glyph as an optional suffix mark. Used as-is; no icon logo in v1.

### 2.1 Personal brand attribution — Rajkumar Rajagobalan

The founder's name is part of the brand and appears at **moments of trust**, never as chrome-filling decoration:

| Placement | Treatment |
|---|---|
| Landing pages & catalog | "Led by Rajkumar Rajagobalan" byline on every workshop; founder bio block on landing pages |
| Certificates | Signature line: *Rajkumar Rajagobalan, Facilitator* — bilingual |
| Marketing & B2B email | Sign-off in the sender's voice (JA: 敬語 register) |
| Org monthly reports | Authored-by line on the cover |
| Public site footer | "WorkshopOS by Rajkumar Rajagobalan" |
| Copilot greeting | Addresses the owner by first name |

**Where the name does *not* appear:** checkout flow (keep transactional surfaces frictionless), admin UI chrome, error messages, participant nudges.

**Japanese rendering:** ラジクマール・ラジャゴバラン (middle dot separator, katakana; family-name order kept as source since it is a non-Japanese name). ⚠ Confirm this katakana spelling with the owner — personal-name transliterations are the owner's call, not the system's.

## 3. Color tokens

Palette drawn from Japanese traditional colors (伝統色). One accent; functional colors are muted, never neon.

| Token | Hex | Name | Use |
|---|---|---|---|
| `--paper` | `#F8F8F5` | 生成り (neutral washi) | App background |
| `--surface` | `#FFFFFF` | 白 | Cards, panels |
| `--ink` | `#20242B` | 墨 (sumi) | Primary text |
| `--ink-soft` | `#6B7076` | 鈍色 | Secondary text, captions |
| `--ai-600` | `#165E83` | 藍色 (ai) | **Brand accent**: primary buttons, links, active states, copilot identity |
| `--ai-700` | `#114A68` | 紺藍 | Hover/pressed |
| `--ai-100` | `#E3EEF3` | 藍白 | Accent tint backgrounds, selected rows |
| `--shu` | `#B8432F` | 朱 (shu) | Owner-tier badges, destructive actions, errors — used rarely, so it lands |
| `--matsu` | `#3E7A5E` | 松葉 | Success, completion, paid |
| `--kin` | `#A8842C` | 黄金鈍 | Pending, awaiting approval |
| `--line` | `#E3E2DC` | — | Hairline rules (1px) |
| `--line-strong` | `#C9C8C0` | — | Emphasized rules, table headers |

**Rules:** never use pure black `#000`; never introduce a second saturated hue; `--shu` appears on at most one element per screen.

## 4. Typography

One superfamily plus one display voice — chosen so Latin and Japanese render as a single harmonized system:

| Role | Face | Notes |
|---|---|---|
| UI & body (EN+JA) | **IBM Plex Sans JP** | Harmonized Latin/kana/kanji in one family — no script mismatch |
| Display & section titles | **Shippori Mincho** (JA) / IBM Plex Sans JP SemiBold (EN-only contexts) | The mincho serif carries the モダンクラシック note without making the app feel like a brochure |
| Data, money, code | **IBM Plex Mono** | Order totals, seat counts, promo codes, ledger IDs |

**Bilingual typesetting rules (non-negotiable):**
- Body line-height: **1.7 for EN, 1.8 for JA** (JA needs more air; tokens: `--lh-en`, `--lh-ja` switched with `:lang()`)
- **Never italicize Japanese.** Emphasis in JA = weight or accent color.
- JA letter-spacing `0.02em` body; display headings may use `font-feature-settings: "palt"` (proportional kana) — body text never does.
- Numerals are always Latin (no full-width digits in data contexts).
- Type scale (px): 30 display / 20 section / 16 subhead / 14.5 body / 12.5 caption.

## 5. Signature element: the tategaki label

Every major screen region carries a small **vertical (縦書き) label** on its left edge — `writing-mode: vertical-rl`, caption size, `--ink-soft`, tracking wide. In EN locale the same label renders rotated Latin text, so the signature survives both languages. This is the one element that makes a Workshop OS screen recognizable at a glance, and it costs nothing in usability. Nothing else on the screen competes with it for personality.

## 6. Layout & spacing

- 8px base unit; spacing steps 8 / 16 / 24 / 40 / 64.
- 12-column grid, max content width 1200px; admin screens may use a 240px fixed nav rail.
- Structure comes from **hairlines and whitespace**, not card shadows. Shadows are reserved for true overlays (modals, popovers) only.
- Corner radius: 6px inputs/buttons, 10px panels. Nothing pill-shaped except locale and tier badges.
- Section rhythm: every section opens with the tategaki label + a 1px rule; content hangs from that rule.

## 7. Components

- **Buttons:** primary = `--ai-600` fill, white text; secondary = 1px `--line-strong` outline; destructive = `--shu` outline (fill only in confirm dialogs). Verbs, not nouns: "Publish workshop / ワークショップを公開".
- **Tier badges (AI actions):** `auto` = `--ai-100` tint; `approve` = `--kin` tint; `owner` = `--shu` tint. Badge text is the tier word in the UI locale. These badges appear anywhere an agent proposes an action — they are the visual contract of spec §7.
- **Tables:** hairline rows, no zebra stripes; money right-aligned in Plex Mono; JPY shown as ¥45,000 (no decimals), USD as $310.00.
- **Copilot surface:** the copilot's messages carry a thin left border in `--ai-600` — the agent is *marked*, never disguised as a human or as the user.
- **Forms:** labels above fields; JA labels never truncate; error text in `--shu` with the fix stated plainly.
- **Empty states:** one line of direction + one action. No illustrations of sad boxes.

## 8. Motion

Subtle and fine-grained (印象的・細やかな動き): 160–240ms ease-out fades and 8px rises on section reveal; approval-state changes crossfade. No parallax in the app (landing pages may use restrained scroll reveals). `prefers-reduced-motion` disables all of it.

## 9. Voice & tone

| Surface | EN register | JA register |
|---|---|---|
| Marketing / landing | Confident, concrete, no hype | です・ます, warm but professional |
| B2B (org portal, invoices, email) | Formal-plain | 敬語 (proper keigo; sonkeigo where addressing the client's actions) |
| Participant nudges | Friendly, brief | 丁寧語, encouraging, never scolding |
| Copilot | Colleague: states what it did, what it needs approval for, and why | Same, in 丁寧語; always self-identifies as AI |

Microcopy rules: buttons say exactly what happens; the same action keeps the same name everywhere; errors say what went wrong and how to fix it.

## 10. Accessibility & quality floor

Contrast ≥ 4.5:1 for text (all tokens above pass on their assigned backgrounds); visible keyboard focus (2px `--ai-600` outline, offset 2px); touch targets ≥ 44px; every icon paired with text or aria-label; locale switch never loses page state; responsive to 380px.

## 11. Don'ts

No gradients as decoration; no emoji in UI chrome; no second accent hue; no drop shadows on cards; no full-width JA digits in data; no italic JA; no cream-and-terracotta "AI default" palette; no mascot.
