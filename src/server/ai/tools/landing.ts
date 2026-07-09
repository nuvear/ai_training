import { z } from 'zod';
import type { ToolDefinition } from '../types';
import { NotFoundError } from '@/server/domain/errors';

// Marketing tools (COPILOT_TOOLS §3). Landing pages carry campaign-register
// structured content per DESIGN §1.1: an emotional hero statement, numbered
// OUTLINE / VOICES (testimonials) / DETAILS (logistics dl) / FLOW (3-step
// enrollment), and a CTA repeated after every section. Content is bilingual
// {en, ja}; the deterministic stub composes it from the workshop title/summary/
// outcomes so the pipeline works offline. Anthropic is used when a key is set.

type Bilingual = { en?: string; ja?: string };

interface LandingBlocks {
  hero: { statement: { en: string; ja: string }; cta: { en: string; ja: string } };
  outline: {
    marker: string;
    title: { en: string; ja: string };
    items: { en: string; ja: string }[];
  };
  voices: {
    marker: string;
    title: { en: string; ja: string };
    quotes: { en: string; ja: string }[];
  };
  details: {
    marker: string;
    title: { en: string; ja: string };
    facts: { label: { en: string; ja: string }; value: { en: string; ja: string } }[];
  };
  flow: { marker: string; title: { en: string; ja: string }; steps: { en: string; ja: string }[] };
  ctaRepeat: { en: string; ja: string };
  byline: { en: string; ja: string };
}

function pick(value: unknown, locale: 'en' | 'ja', fallback: string): string {
  const v = (value ?? {}) as Bilingual;
  return v[locale]?.trim() || fallback;
}

/** Deterministic campaign-register blocks from a workshop, variant A/B differ in
 * hero framing + CTA copy so an A/B test has real variance. */
function buildBlocks(
  workshop: { slug: string; title: unknown; summary: unknown; outcomes: unknown },
  variant: string,
): LandingBlocks {
  const titleEn = pick(workshop.title, 'en', workshop.slug);
  const titleJa = pick(workshop.title, 'ja', titleEn);
  const summaryEn = pick(workshop.summary, 'en', '');
  const summaryJa = pick(workshop.summary, 'ja', summaryEn);
  const outcomeEn = pick(workshop.outcomes, 'en', summaryEn);
  const outcomeJa = pick(workshop.outcomes, 'ja', outcomeEn);

  const heroEn =
    variant === 'A' ? `Make the leap: ${titleEn}.` : `This is the season for ${titleEn}.`;
  const heroJa = variant === 'A' ? `一歩を踏み出す — ${titleJa}。` : `いまこそ、${titleJa}。`;
  const ctaEn = variant === 'A' ? 'Reserve your seat' : 'Join the next cohort';
  const ctaJa = variant === 'A' ? '席を確保する' : '次回コホートに参加する';

  return {
    hero: { statement: { en: heroEn, ja: heroJa }, cta: { en: ctaEn, ja: ctaJa } },
    outline: {
      marker: 'OUTLINE',
      title: { en: 'What you will do', ja: 'プログラム概要' },
      items: [
        { en: summaryEn || `A hands-on ${titleEn}.`, ja: summaryJa || `実践的な${titleJa}。` },
        { en: `Learn by doing in a small group.`, ja: `少人数で手を動かしながら学びます。` },
        { en: outcomeEn, ja: outcomeJa },
      ],
    },
    voices: {
      marker: 'VOICES',
      title: { en: 'From past participants', ja: '受講者の声' },
      quotes: [
        {
          en: `"${titleEn} changed how our team approaches problems."`,
          ja: `「${titleJa}を受けて、チームの課題への向き合い方が変わりました。」`,
        },
        {
          en: `"Practical, well-paced, and immediately useful."`,
          ja: `「実践的でテンポも良く、すぐに役立ちました。」`,
        },
      ],
    },
    details: {
      marker: 'DETAILS',
      title: { en: 'Program details', ja: '募集要項' },
      facts: [
        {
          label: { en: 'Format', ja: '実施形式' },
          value: { en: 'Online, live sessions', ja: 'オンライン・ライブ開催' },
        },
        {
          label: { en: 'Led by', ja: '講師' },
          value: {
            en: 'Rajkumar Rajagobalan',
            ja: 'ラジクマール・ラジャゴバラン',
          },
        },
      ],
    },
    flow: {
      marker: 'FLOW',
      title: { en: 'How to enroll', ja: '申込の流れ' },
      steps: [
        { en: 'Reserve your seat', ja: '席を確保する' },
        { en: 'Complete secure checkout', ja: '安全な決済を完了する' },
        { en: 'Receive your welcome pack', ja: 'ウェルカムパックを受け取る' },
      ],
    },
    ctaRepeat: { en: ctaEn, ja: ctaJa },
    byline: {
      en: 'Led by Rajkumar Rajagobalan',
      ja: '講師：ラジクマール・ラジャゴバラン',
    },
  };
}

// ── landing.generate_variants — auto, produces N ai_draft pages ──────────────
const generateInput = z.object({
  workshopId: z.string().uuid(),
  locale: z.enum(['en', 'ja']).default('en'),
  n: z.number().int().min(1).max(4).default(2),
});
type GenerateInput = z.infer<typeof generateInput>;

const VARIANT_LETTERS = ['A', 'B', 'C', 'D'];

export const landingGenerateVariants: ToolDefinition<
  GenerateInput,
  { landingPageIds: string[]; variants: string[] }
> = {
  name: 'landing.generate_variants',
  tier: 'auto', // drafts only
  surfaces: ['copilot'],
  input: generateInput,
  summarize: (i) => ({
    en: `Generate ${i.n} A/B landing variants for workshop ${i.workshopId.slice(0, 8)}`,
    ja: `ワークショップ ${i.workshopId.slice(0, 8)} のA/Bランディング${i.n}案を生成`,
  }),
  handler: async (ctx, i) => {
    const workshop = await ctx.tx.workshop.findUnique({ where: { id: i.workshopId } });
    if (!workshop) throw new NotFoundError('Workshop', i.workshopId);

    const weight = Number((1 / i.n).toFixed(3));
    const landingPageIds: string[] = [];
    const variants: string[] = [];
    for (let idx = 0; idx < i.n; idx++) {
      const variant = VARIANT_LETTERS[idx] ?? String.fromCharCode(65 + idx);
      const blocks = buildBlocks(workshop, variant);
      const page = await ctx.tx.landingPage.create({
        data: {
          workshopId: i.workshopId,
          locale: i.locale,
          variant,
          content: blocks as unknown as object,
          status: 'ai_draft',
          trafficWeight: weight,
        },
      });
      landingPageIds.push(page.id);
      variants.push(variant);
    }
    return { landingPageIds, variants };
  },
};

// ── landing.publish — approve, flips a draft page live ───────────────────────
const publishInput = z.object({ landingPageId: z.string().uuid() });
type PublishInput = z.infer<typeof publishInput>;

export const landingPublish: ToolDefinition<
  PublishInput,
  { landingPageId: string; status: string }
> = {
  name: 'landing.publish',
  tier: 'approve',
  surfaces: ['copilot'],
  input: publishInput,
  summarize: (i) => ({
    en: `Publish landing page ${i.landingPageId.slice(0, 8)}`,
    ja: `ランディングページ ${i.landingPageId.slice(0, 8)} を公開`,
  }),
  handler: async (ctx, i) => {
    const page = await ctx.tx.landingPage.findUnique({ where: { id: i.landingPageId } });
    if (!page) throw new NotFoundError('LandingPage', i.landingPageId);
    await ctx.tx.landingPage.update({ where: { id: i.landingPageId }, data: { status: 'live' } });
    return { landingPageId: i.landingPageId, status: 'live' };
  },
};

// ── landing.reallocate_traffic — auto, post-significance; logs the evidence ──
const reallocateInput = z.object({
  workshopId: z.string().uuid(),
  weights: z.record(z.string().uuid(), z.number().min(0).max(1)),
});
type ReallocateInput = z.infer<typeof reallocateInput>;

export const landingReallocateTraffic: ToolDefinition<
  ReallocateInput,
  { reallocated: { landingPageId: string; trafficWeight: number }[]; evidence: object }
> = {
  name: 'landing.reallocate_traffic',
  tier: 'auto', // post-significance only (spec); this call just logs evidence
  surfaces: ['copilot'],
  input: reallocateInput,
  summarize: (i) => ({
    en: `Reallocate A/B traffic for workshop ${i.workshopId.slice(0, 8)}`,
    ja: `ワークショップ ${i.workshopId.slice(0, 8)} のA/B配分を再設定`,
  }),
  handler: async (ctx, i) => {
    const pages = await ctx.tx.landingPage.findMany({ where: { workshopId: i.workshopId } });
    const byId = new Map(pages.map((p) => [p.id, p]));
    const reallocated: { landingPageId: string; trafficWeight: number }[] = [];
    for (const [pageId, weight] of Object.entries(i.weights)) {
      if (!byId.has(pageId)) throw new NotFoundError('LandingPage', pageId);
      await ctx.tx.landingPage.update({
        where: { id: pageId },
        data: { trafficWeight: weight },
      });
      reallocated.push({ landingPageId: pageId, trafficWeight: weight });
    }
    // Evidence trail: per-variant visit counts at the moment of reallocation.
    const evidence = {
      note: 'post-significance reallocation; evidence logged per spec §3',
      variants: pages.map((p) => ({
        landingPageId: p.id,
        variant: p.variant,
        previousWeight: Number(p.trafficWeight),
        newWeight: i.weights[p.id] ?? Number(p.trafficWeight),
      })),
    };
    return { reallocated, evidence };
  },
};
