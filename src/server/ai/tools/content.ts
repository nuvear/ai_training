import { z } from 'zod';
import type { ToolDefinition } from '../types';
import { localeEnum, registerEnum } from '../schemas';
import { localizeText, type Register } from '../localize';
import { NotFoundError } from '@/server/domain/errors';
import type { Locale } from '@/generated/prisma';

type Bilingual = { en?: string; ja?: string };
const I18N_FIELDS = ['title', 'summary', 'description', 'outcomes'] as const;

// ── content.localize ─────────────────────────────────────────────────────────
const localizeInput = z.object({
  entityType: z.literal('workshop').default('workshop'),
  entityId: z.string().uuid(),
  targetLocale: localeEnum,
  register: registerEnum.default('polite'),
});
type LocalizeInput = z.infer<typeof localizeInput>;

export const contentLocalize: ToolDefinition<
  LocalizeInput,
  { localized: string[]; provider: string }
> = {
  name: 'content.localize',
  tier: 'auto',
  surfaces: ['copilot', 'scheduler'],
  input: localizeInput,
  summarize: (i) => ({
    en: `Localize workshop ${i.entityId.slice(0, 8)} → ${i.targetLocale.toUpperCase()}`,
    ja: `ワークショップ ${i.entityId.slice(0, 8)} を${i.targetLocale === 'ja' ? '日本語' : '英語'}にローカライズ`,
  }),
  handler: async (ctx, i) => {
    const workshop = await ctx.tx.workshop.findUnique({ where: { id: i.entityId } });
    if (!workshop) throw new NotFoundError('Workshop', i.entityId);

    const target = i.targetLocale as Locale;
    const source: Locale = target === 'ja' ? 'en' : 'ja';
    const localized: string[] = [];
    let provider = 'stub';
    const updates: Record<string, Bilingual> = {};

    for (const field of I18N_FIELDS) {
      const value = (workshop[field] ?? {}) as Bilingual;
      const srcText = value[source]?.trim();
      if (!srcText) continue;
      const result = await localizeText({
        text: srcText,
        sourceLocale: source,
        targetLocale: target,
        register: i.register as Register,
      });
      provider = result.provider;
      updates[field] = { ...value, [target]: result.text };
      localized.push(field);
    }

    const review = {
      ...((workshop.localizationReview ?? {}) as Record<string, string>),
      [target]: 'ai_localized',
    };
    await ctx.tx.workshop.update({
      where: { id: i.entityId },
      data: { ...updates, localizationReview: review },
    });

    return { localized, provider };
  },
};

// ── content.mark_reviewed ────────────────────────────────────────────────────
const markReviewedInput = z.object({
  entityType: z.literal('workshop').default('workshop'),
  entityId: z.string().uuid(),
  locale: localeEnum,
});
type MarkReviewedInput = z.infer<typeof markReviewedInput>;

export const contentMarkReviewed: ToolDefinition<
  MarkReviewedInput,
  { entityId: string; locale: string }
> = {
  name: 'content.mark_reviewed',
  tier: 'approve', // human attestation
  surfaces: ['copilot'],
  input: markReviewedInput,
  summarize: (i) => ({
    en: `Mark ${i.locale.toUpperCase()} of workshop ${i.entityId.slice(0, 8)} human-reviewed`,
    ja: `ワークショップ ${i.entityId.slice(0, 8)} の${i.locale === 'ja' ? '日本語' : '英語'}をレビュー済みに設定`,
  }),
  handler: async (ctx, i) => {
    const workshop = await ctx.tx.workshop.findUnique({ where: { id: i.entityId } });
    if (!workshop) throw new NotFoundError('Workshop', i.entityId);
    const review = {
      ...((workshop.localizationReview ?? {}) as Record<string, string>),
      [i.locale]: 'human_reviewed',
    };
    await ctx.tx.workshop.update({
      where: { id: i.entityId },
      data: { localizationReview: review },
    });
    return { entityId: i.entityId, locale: i.locale };
  },
};

// ── content.generate ─────────────────────────────────────────────────────────
const generateInput = z.object({
  workshopId: z.string().uuid(),
  kind: z.enum(['description', 'outcomes', 'faq', 'bio']),
});
type GenerateInput = z.infer<typeof generateInput>;

export const contentGenerate: ToolDefinition<
  GenerateInput,
  { workshopId: string; kind: string; field?: string }
> = {
  name: 'content.generate',
  tier: 'auto', // drafts only
  surfaces: ['copilot'],
  input: generateInput,
  summarize: (i) => ({
    en: `Generate ${i.kind} draft for workshop ${i.workshopId.slice(0, 8)}`,
    ja: `ワークショップ ${i.workshopId.slice(0, 8)} の${i.kind}下書きを生成`,
  }),
  handler: async (ctx, i) => {
    const workshop = await ctx.tx.workshop.findUnique({ where: { id: i.workshopId } });
    if (!workshop) throw new NotFoundError('Workshop', i.workshopId);

    // Only description/outcomes map to workshop i18n fields in M1. faq/bio are
    // acknowledged but not yet persisted (landing-page content arrives in M5).
    if (i.kind !== 'description' && i.kind !== 'outcomes') {
      return { workshopId: i.workshopId, kind: i.kind };
    }

    const title = ((workshop.title ?? {}) as Bilingual).en ?? workshop.slug;
    const summary = ((workshop.summary ?? {}) as Bilingual).en ?? '';
    const draftEn =
      i.kind === 'description'
        ? `About "${title}". ${summary} This hands-on workshop is run in a small group so you learn by doing.`
        : `By the end of "${title}", participants can apply the core skills to a real problem of their own.`;

    const existing = (workshop[i.kind] ?? {}) as Bilingual;
    await ctx.tx.workshop.update({
      where: { id: i.workshopId },
      data: { [i.kind]: { ...existing, en: draftEn } },
    });
    return { workshopId: i.workshopId, kind: i.kind, field: i.kind };
  },
};
