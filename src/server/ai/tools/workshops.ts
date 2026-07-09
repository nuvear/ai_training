import { z } from 'zod';
import type { ToolDefinition } from '../types';
import { bilingualDraft, levelEnum, mergeBilingual, slugify } from '../schemas';
import { BilingualIncompleteError, InvalidStateError, NotFoundError } from '@/server/domain/errors';

// Content fields that must be bilingual before a workshop leaves draft.
const I18N_FIELDS = ['title', 'summary', 'description', 'outcomes'] as const;

type Bilingual = { en?: string; ja?: string };

/** A field blocks publish if it has content in one locale but not the other. */
function publishGate(workshop: Record<string, unknown>): void {
  const missing: Array<{ field: string; locale: 'en' | 'ja' }> = [];
  for (const field of I18N_FIELDS) {
    const value = (workshop[field] ?? {}) as Bilingual;
    const hasEn = Boolean(value.en?.trim());
    const hasJa = Boolean(value.ja?.trim());
    if (hasEn !== hasJa) missing.push({ field, locale: hasEn ? 'ja' : 'en' });
    // title + summary are mandatory content: require both present.
    if ((field === 'title' || field === 'summary') && !(hasEn && hasJa)) {
      if (!hasEn) missing.push({ field, locale: 'en' });
      if (!hasJa) missing.push({ field, locale: 'ja' });
    }
  }
  if (missing.length) {
    // dedupe
    const seen = new Set<string>();
    const unique = missing.filter((m) => {
      const k = `${m.field}.${m.locale}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    throw new BilingualIncompleteError([...I18N_FIELDS], unique);
  }
}

const createInput = z.object({
  slug: z.string().trim().min(1).max(60).optional(),
  title: bilingualDraft,
  summary: bilingualDraft,
  description: bilingualDraft.optional(),
  outcomes: bilingualDraft.optional(),
  level: levelEnum.default('intro'),
  skills: z.array(z.string().trim().min(1)).max(6).default([]),
});
type CreateInput = z.infer<typeof createInput>;

export const workshopCreate: ToolDefinition<CreateInput, { workshopId: string; slug: string }> = {
  name: 'workshop.create',
  tier: 'auto',
  surfaces: ['copilot'],
  input: createInput,
  summarize: (i) => ({
    en: `Create workshop draft "${i.title.en}"`,
    ja: `ワークショップ下書き「${i.title.ja ?? i.title.en}」を作成`,
  }),
  handler: async (_ctx, i) => {
    const slug = i.slug ?? slugify(i.title.en);
    const workshop = await _ctx.tx.workshop.create({
      data: {
        slug,
        title: i.title,
        summary: i.summary,
        description: i.description ?? {},
        outcomes: i.outcomes ?? {},
        level: i.level,
        status: 'draft',
        // EN is human-authored; JA (if present here) is also human-authored.
        localizationReview: { en: 'human_reviewed' },
      },
    });

    for (const skillSlug of i.skills) {
      const s = slugify(skillSlug);
      const skill = await _ctx.tx.skill.upsert({
        where: { slug: s },
        update: {},
        create: { slug: s, name: { en: skillSlug, ja: skillSlug } },
      });
      await _ctx.tx.workshopSkill.upsert({
        where: { workshopId_skillId: { workshopId: workshop.id, skillId: skill.id } },
        update: {},
        create: { workshopId: workshop.id, skillId: skill.id },
      });
    }

    return { workshopId: workshop.id, slug: workshop.slug };
  },
};

const updateInput = z.object({
  workshopId: z.string().uuid(),
  patch: z.object({
    title: bilingualDraft.partial().optional(),
    summary: bilingualDraft.partial().optional(),
    description: bilingualDraft.partial().optional(),
    outcomes: bilingualDraft.partial().optional(),
    level: levelEnum.optional(),
  }),
});
type UpdateInput = z.infer<typeof updateInput>;

export const workshopUpdate: ToolDefinition<UpdateInput, { workshopId: string }> = {
  name: 'workshop.update',
  tier: 'auto', // drafts only; editing a published workshop is an approve-tier concern
  surfaces: ['copilot'],
  input: updateInput,
  summarize: (i) => ({
    en: `Update workshop draft ${i.workshopId.slice(0, 8)}`,
    ja: `ワークショップ下書き ${i.workshopId.slice(0, 8)} を更新`,
  }),
  handler: async (ctx, i) => {
    const workshop = await ctx.tx.workshop.findUnique({ where: { id: i.workshopId } });
    if (!workshop) throw new NotFoundError('Workshop', i.workshopId);
    if (workshop.status !== 'draft') {
      throw new InvalidStateError('workshop.update (auto) only edits drafts');
    }
    await ctx.tx.workshop.update({
      where: { id: i.workshopId },
      data: {
        title: mergeBilingual(workshop.title, i.patch.title),
        summary: mergeBilingual(workshop.summary, i.patch.summary),
        description: mergeBilingual(workshop.description, i.patch.description),
        outcomes: mergeBilingual(workshop.outcomes, i.patch.outcomes),
        ...(i.patch.level ? { level: i.patch.level } : {}),
      },
    });
    return { workshopId: i.workshopId };
  },
};

const idInput = z.object({ workshopId: z.string().uuid() });
type IdInput = z.infer<typeof idInput>;

export const workshopPublish: ToolDefinition<IdInput, { workshopId: string; status: string }> = {
  name: 'workshop.publish',
  tier: 'approve',
  surfaces: ['copilot'],
  input: idInput,
  summarize: (i) => ({
    en: `Publish workshop ${i.workshopId.slice(0, 8)}`,
    ja: `ワークショップ ${i.workshopId.slice(0, 8)} を公開`,
  }),
  handler: async (ctx, i) => {
    const workshop = await ctx.tx.workshop.findUnique({ where: { id: i.workshopId } });
    if (!workshop) throw new NotFoundError('Workshop', i.workshopId);
    // Bilingual gate — throws a typed error if either locale is missing.
    publishGate(workshop as unknown as Record<string, unknown>);
    await ctx.tx.workshop.update({ where: { id: i.workshopId }, data: { status: 'published' } });
    return { workshopId: i.workshopId, status: 'published' };
  },
};

export const workshopArchive: ToolDefinition<IdInput, { workshopId: string; status: string }> = {
  name: 'workshop.archive',
  tier: 'approve',
  surfaces: ['copilot'],
  input: idInput,
  summarize: (i) => ({
    en: `Archive workshop ${i.workshopId.slice(0, 8)}`,
    ja: `ワークショップ ${i.workshopId.slice(0, 8)} をアーカイブ`,
  }),
  handler: async (ctx, i) => {
    const workshop = await ctx.tx.workshop.findUnique({ where: { id: i.workshopId } });
    if (!workshop) throw new NotFoundError('Workshop', i.workshopId);
    await ctx.tx.workshop.update({ where: { id: i.workshopId }, data: { status: 'archived' } });
    return { workshopId: i.workshopId, status: 'archived' };
  },
};

// Exported for direct use by the publish-gate test.
export { publishGate };
