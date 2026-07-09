import { z } from 'zod';
import type { ToolDefinition } from '../types';
import { NotFoundError } from '@/server/domain/errors';
import { assertPromoApplicable, PromoInvalidError } from '@/server/domain/commerce';
import { beginCheckout } from '@/server/domain/checkout';
import { prisma } from '@/server/db/client';
import type { BilingualText } from '../i18n-content';
import type { SessionUser } from '@/server/auth/session';

// ─────────────────────────────────────────────────────────────────────────────
// Concierge surface tools (COPILOT_TOOLS §7). REGISTERED with
// `surfaces:['concierge']` so `assertSurfaceAllowed` structurally blocks any
// copilot-only tool from the public chatbot. Every tool here is read-only or a
// checkout hand-off — none can apply discounts, create content, or see another
// user's data.
//
// These are registered so the surface gate + plan preview know them, but the
// public concierge executes them through the dedicated concierge runner (see
// src/server/ai/concierge.ts), NOT the copilot ledger, because the concierge has
// no authenticated staff session. Their `handler` here reuses the same underlying
// domain functions so logic is never forked; when driven from the copilot surface
// (never, given the surface list) the handler would still be correct.
//
// Injection defense: all user text is treated as data. The tools take structured
// params only; free text never reaches a tool as an instruction.
// ─────────────────────────────────────────────────────────────────────────────

// ── catalog.search ───────────────────────────────────────────────────────────
const catalogSearchInput = z.object({
  query: z.string().trim().max(200).default(''),
});
type CatalogSearchInput = z.infer<typeof catalogSearchInput>;

export interface CatalogHit {
  workshopId: string;
  slug: string;
  title: BilingualText;
  summary: BilingualText;
  level: string;
  openCohorts: number;
}

export async function runCatalogSearch(query: string): Promise<CatalogHit[]> {
  const workshops = await prisma.workshop.findMany({
    where: { status: 'published' },
    include: { cohorts: { where: { status: { in: ['open', 'full'] } }, select: { id: true } } },
    orderBy: { createdAt: 'desc' },
  });
  const q = query.trim().toLowerCase();
  const filtered = q
    ? workshops.filter((w) => {
        const t = w.title as BilingualText;
        const s = w.summary as BilingualText;
        return [t.en, t.ja, s.en, s.ja].some((v) => v?.toLowerCase().includes(q));
      })
    : workshops;
  return filtered.map((w) => ({
    workshopId: w.id,
    slug: w.slug,
    title: w.title as BilingualText,
    summary: w.summary as BilingualText,
    level: w.level,
    openCohorts: w.cohorts.length,
  }));
}

export const catalogSearch: ToolDefinition<CatalogSearchInput, { results: CatalogHit[] }> = {
  name: 'catalog.search',
  tier: 'auto',
  surfaces: ['concierge'],
  input: catalogSearchInput,
  summarize: (i) => ({
    en: `Search published catalog for "${i.query}"`,
    ja: `公開カタログを「${i.query}」で検索`,
  }),
  handler: async (_ctx, i) => ({ results: await runCatalogSearch(i.query) }),
};

// ── cohort.availability ──────────────────────────────────────────────────────
const availabilityInput = z.object({
  cohortId: z.string().uuid().optional(),
  workshopSlug: z.string().trim().optional(),
});
type AvailabilityInput = z.infer<typeof availabilityInput>;

export interface CohortAvailability {
  cohortId: string;
  startsAt: string;
  endsAt: string;
  seatsLeft: number;
  priceJpy: number | null;
  priceUsd: number | null;
  status: string;
}

export async function runCohortAvailability(
  args: AvailabilityInput,
): Promise<CohortAvailability[]> {
  const where = args.cohortId
    ? { id: args.cohortId, workshop: { status: 'published' as const } }
    : args.workshopSlug
      ? { workshop: { slug: args.workshopSlug, status: 'published' as const } }
      : { workshop: { status: 'published' as const } };

  const cohorts = await prisma.cohort.findMany({
    where: { ...where, status: { in: ['open', 'full'] } },
    include: { _count: { select: { enrollments: true } } },
    orderBy: { startsAt: 'asc' },
  });

  return cohorts.map((c) => ({
    cohortId: c.id,
    startsAt: c.startsAt.toISOString(),
    endsAt: c.endsAt.toISOString(),
    seatsLeft: Math.max(0, c.capacity - c._count.enrollments),
    priceJpy: c.priceJpy,
    priceUsd: c.priceUsd,
    status: c.status,
  }));
}

export const cohortAvailability: ToolDefinition<
  AvailabilityInput,
  { cohorts: CohortAvailability[] }
> = {
  name: 'cohort.availability',
  tier: 'auto',
  surfaces: ['concierge'],
  input: availabilityInput,
  summarize: (i) => ({
    en: `Check cohort availability${i.workshopSlug ? ` for ${i.workshopSlug}` : ''}`,
    ja: `コホートの空席状況を確認${i.workshopSlug ? `（${i.workshopSlug}）` : ''}`,
  }),
  handler: async (_ctx, i) => ({ cohorts: await runCohortAvailability(i) }),
};

// ── promo.validate ───────────────────────────────────────────────────────────
const promoValidateInput = z.object({
  code: z.string().trim().min(1).max(64),
  currency: z.enum(['JPY', 'USD']),
  cohortId: z.string().uuid().optional(),
});
type PromoValidateInput = z.infer<typeof promoValidateInput>;

export interface PromoValidation {
  valid: boolean;
  reason?: string;
  type?: string;
  value?: number;
}

export async function runPromoValidate(args: PromoValidateInput): Promise<PromoValidation> {
  const promo = await prisma.promoCode.findUnique({ where: { code: args.code } });
  if (!promo) return { valid: false, reason: 'not_found' };
  try {
    assertPromoApplicable(promo, { currency: args.currency, cohortId: args.cohortId ?? null });
    return { valid: true, type: promo.type, value: promo.value };
  } catch (err) {
    if (err instanceof PromoInvalidError) return { valid: false, reason: err.reason };
    return { valid: false, reason: 'invalid' };
  }
}

export const promoValidate: ToolDefinition<PromoValidateInput, PromoValidation> = {
  name: 'promo.validate',
  tier: 'auto',
  surfaces: ['concierge'],
  input: promoValidateInput,
  summarize: (i) => ({
    en: `Validate promo code ${i.code}`,
    ja: `プロモコード ${i.code} を確認`,
  }),
  handler: async (_ctx, i) => runPromoValidate(i),
};

// ── enrollment.begin_checkout ────────────────────────────────────────────────
// Hands off to the shared beginCheckout (concierge never touches payment data).
const beginCheckoutInput = z.object({
  cohortId: z.string().uuid(),
  currency: z.enum(['JPY', 'USD']),
  promoCode: z.string().trim().min(1).max(64).optional(),
  methods: z
    .array(z.enum(['card', 'konbini']))
    .min(1)
    .default(['card']),
});
type BeginCheckoutInput = z.infer<typeof beginCheckoutInput>;

export interface ConciergeCheckoutResult {
  orderId: string;
  checkoutUrl: string;
  total: number;
  currency: string;
}

/** The concierge must run as an identified participant (checkout creates an order
 * for a real buyer). The endpoint resolves the session user and passes it here. */
export async function runBeginCheckout(
  session: SessionUser,
  args: BeginCheckoutInput,
): Promise<ConciergeCheckoutResult> {
  const cohort = await prisma.cohort.findFirst({
    where: { id: args.cohortId, workshop: { status: 'published' } },
    select: { id: true },
  });
  if (!cohort) throw new NotFoundError('Cohort', args.cohortId);

  const result = await beginCheckout({
    session,
    kind: 'individual_enrollment',
    cohortId: args.cohortId,
    currency: args.currency,
    promoCode: args.promoCode,
    methods: args.methods,
  });
  return {
    orderId: result.orderId,
    checkoutUrl: result.checkoutUrl,
    total: result.total,
    currency: result.currency,
  };
}

export const enrollmentBeginCheckout: ToolDefinition<BeginCheckoutInput, ConciergeCheckoutResult> =
  {
    name: 'enrollment.begin_checkout',
    tier: 'auto',
    surfaces: ['concierge'],
    input: beginCheckoutInput,
    summarize: (i) => ({
      en: `Begin checkout for cohort ${i.cohortId.slice(0, 8)} (${i.currency})`,
      ja: `コホート ${i.cohortId.slice(0, 8)} の購入手続きを開始（${i.currency}）`,
    }),
    handler: async (ctx, i) => runBeginCheckout(ctx.session, i),
  };

// ── faq.answer ───────────────────────────────────────────────────────────────
// RAG-ish over APPROVED/PUBLISHED content only. MUST self-identify as AI.
const faqInput = z.object({
  question: z.string().trim().min(1).max(500),
  locale: z.enum(['en', 'ja']).default('en'),
});
type FaqInput = z.infer<typeof faqInput>;

export interface FaqAnswer {
  answer: string;
  isAi: true;
  sources: Array<{ slug: string; title: BilingualText }>;
}

const AI_PREFIX = {
  en: '(AI assistant) ',
  ja: '（AIアシスタント）',
} as const;

export async function runFaqAnswer(args: FaqInput): Promise<FaqAnswer> {
  // Retrieve over published workshops only (approved content). Keyword overlap
  // ranking — deterministic; the model, when present, only phrases the answer.
  const workshops = await prisma.workshop.findMany({
    where: { status: 'published' },
    select: { slug: true, title: true, summary: true, description: true },
  });

  const q = args.question.toLowerCase();
  const terms = q.split(/\W+/).filter((t) => t.length > 2);
  const scored = workshops
    .map((w) => {
      const s = w.summary as BilingualText;
      const d = w.description as BilingualText;
      const hay = `${s.en} ${s.ja} ${d.en ?? ''} ${d.ja ?? ''}`.toLowerCase();
      const score = terms.reduce((acc, t) => acc + (hay.includes(t) ? 1 : 0), 0);
      return { w, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  const locale = args.locale;
  const sources = scored.map((x) => ({
    slug: x.w.slug,
    title: x.w.title as BilingualText,
  }));

  let body: string;
  if (scored.length === 0) {
    body =
      locale === 'ja'
        ? '申し訳ございません。公開されている情報の中には、ご質問に対する回答が見つかりませんでした。よろしければ担当者におつなぎいたします。'
        : "I couldn't find that in our published information. I can connect you with a human if you'd like.";
  } else {
    const top = scored[0]!.w.summary as BilingualText;
    body = locale === 'ja' ? top.ja : top.en;
  }

  // Always self-identify as AI (COPILOT_TOOLS §7, PRODUCT_SPEC §7).
  return { answer: `${AI_PREFIX[locale]}${body}`, isAi: true, sources };
}

export const faqAnswer: ToolDefinition<FaqInput, FaqAnswer> = {
  name: 'faq.answer',
  tier: 'auto',
  surfaces: ['concierge'],
  input: faqInput,
  summarize: (i) => ({
    en: `Answer FAQ: "${i.question.slice(0, 40)}"`,
    ja: `FAQに回答：「${i.question.slice(0, 40)}」`,
  }),
  handler: async (_ctx, i) => runFaqAnswer(i),
};

// ── handoff.to_human ─────────────────────────────────────────────────────────
// Opens a ticket for the owner. Implemented as an ai_action row (the ledger IS
// the ticket store) so no schema change is needed.
const handoffInput = z.object({
  reason: z.string().trim().min(1).max(1000),
  sessionKey: z.string().trim().max(200).optional(),
  contactEmail: z.string().email().optional(),
});
type HandoffInput = z.infer<typeof handoffInput>;

export interface HandoffResult {
  ticketId: string;
}

export async function runHandoff(args: HandoffInput): Promise<HandoffResult> {
  // Record the ticket as a concierge ai_action. `reason`/`sessionKey` are user
  // data stored as JSON — never executed. status 'proposed' == open ticket.
  const action = await prisma.aiAction.create({
    data: {
      surface: 'concierge',
      toolName: 'handoff.to_human',
      tier: 'auto',
      input: {
        reason: args.reason,
        sessionKey: args.sessionKey ?? null,
        contactEmail: args.contactEmail ?? null,
      },
      status: 'proposed',
    },
  });
  return { ticketId: action.id };
}

export const handoffToHuman: ToolDefinition<HandoffInput, HandoffResult> = {
  name: 'handoff.to_human',
  tier: 'auto',
  surfaces: ['concierge'],
  input: handoffInput,
  summarize: (i) => ({
    en: `Open a support ticket: "${i.reason.slice(0, 40)}"`,
    ja: `サポートチケットを作成：「${i.reason.slice(0, 40)}」`,
  }),
  handler: async (_ctx, i) => runHandoff(i),
};
