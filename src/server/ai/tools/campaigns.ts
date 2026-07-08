import { z } from 'zod';
import type { ToolDefinition } from '../types';
import { NotFoundError } from '@/server/domain/errors';

// Campaign & social tools (COPILOT_TOOLS §3). Campaigns hold a bilingual email
// sequence: [{ subject:{en,ja}, body:{en,ja}, offsetDays }]. draft_sequence is
// auto (drafts only); approve_and_schedule is approve (one approval covers the
// whole sequence). social.draft_posts NEVER auto-posts (spec §6) — it only
// returns drafts.

type Bilingual = { en?: string; ja?: string };

function titleOf(workshop: { slug: string; title: unknown }): { en: string; ja: string } {
  const t = (workshop.title ?? {}) as Bilingual;
  const en = t.en?.trim() || workshop.slug;
  const ja = t.ja?.trim() || en;
  return { en, ja };
}

interface EmailStep {
  subject: { en: string; ja: string };
  body: { en: string; ja: string };
  offsetDays: number;
}

/** A 3-email announce sequence: reveal → benefits → last call. */
function announceSequence(title: { en: string; ja: string }): EmailStep[] {
  return [
    {
      offsetDays: 0,
      subject: { en: `Now open: ${title.en}`, ja: `受付開始：${title.ja}` },
      body: {
        en: `We are opening enrollment for ${title.en}. Seats are limited — reserve yours early.`,
        ja: `${title.ja}の受付を開始しました。席数には限りがあります。お早めにご予約ください。`,
      },
    },
    {
      offsetDays: 3,
      subject: { en: `What you'll take away from ${title.en}`, ja: `${title.ja}で得られること` },
      body: {
        en: `${title.en} is hands-on and practical. You'll leave with skills you can apply the very next day.`,
        ja: `${title.ja}は実践重視です。翌日から使えるスキルを持ち帰っていただけます。`,
      },
    },
    {
      offsetDays: 7,
      subject: { en: `Last call: ${title.en}`, ja: `最終案内：${title.ja}` },
      body: {
        en: `Enrollment for ${title.en} closes soon. Don't miss this cohort.`,
        ja: `${title.ja}の受付はまもなく締め切ります。今回の開催をお見逃しなく。`,
      },
    },
  ];
}

// ── campaign.draft_sequence — auto, creates a draft Campaign ─────────────────
const draftInput = z.object({
  cohortId: z.string().uuid(),
  kind: z.enum(['announce', 'reminder', 'last_seats']).default('announce'),
});
type DraftInput = z.infer<typeof draftInput>;

export const campaignDraftSequence: ToolDefinition<
  DraftInput,
  { campaignId: string; kind: string; steps: number }
> = {
  name: 'campaign.draft_sequence',
  tier: 'auto', // drafts only
  surfaces: ['copilot'],
  input: draftInput,
  summarize: (i) => ({
    en: `Draft a ${i.kind} email sequence for cohort ${i.cohortId.slice(0, 8)}`,
    ja: `コホート ${i.cohortId.slice(0, 8)} の${i.kind}メール配信を下書き`,
  }),
  handler: async (ctx, i) => {
    const cohort = await ctx.tx.cohort.findUnique({
      where: { id: i.cohortId },
      include: { workshop: true },
    });
    if (!cohort) throw new NotFoundError('Cohort', i.cohortId);
    const title = titleOf(cohort.workshop);
    const sequence = announceSequence(title);
    const campaign = await ctx.tx.campaign.create({
      data: {
        cohortId: i.cohortId,
        kind: i.kind,
        sequence: sequence as unknown as object,
        status: 'draft',
      },
    });
    return { campaignId: campaign.id, kind: i.kind, steps: sequence.length };
  },
};

// ── campaign.approve_and_schedule — approve, one approval covers the sequence ─
const scheduleInput = z.object({
  campaignId: z.string().uuid(),
  scheduledAt: z.string().datetime().optional(),
});
type ScheduleInput = z.infer<typeof scheduleInput>;

export const campaignApproveAndSchedule: ToolDefinition<
  ScheduleInput,
  { campaignId: string; status: string; scheduledAt: string }
> = {
  name: 'campaign.approve_and_schedule',
  tier: 'approve', // one approval covers the whole sequence
  surfaces: ['copilot'],
  input: scheduleInput,
  summarize: (i) => ({
    en: `Approve & schedule campaign ${i.campaignId.slice(0, 8)}`,
    ja: `キャンペーン ${i.campaignId.slice(0, 8)} を承認・予約`,
  }),
  handler: async (ctx, i) => {
    const campaign = await ctx.tx.campaign.findUnique({ where: { id: i.campaignId } });
    if (!campaign) throw new NotFoundError('Campaign', i.campaignId);
    const scheduledAt = i.scheduledAt ? new Date(i.scheduledAt) : new Date();
    await ctx.tx.campaign.update({
      where: { id: i.campaignId },
      data: { status: 'approved', scheduledAt },
    });
    return { campaignId: i.campaignId, status: 'approved', scheduledAt: scheduledAt.toISOString() };
  },
};

// ── social.draft_posts — auto, NEVER auto-posts (spec §6) ────────────────────
const socialInput = z.object({
  cohortId: z.string().uuid(),
  channels: z.array(z.enum(['x', 'linkedin', 'instagram', 'facebook'])).min(1),
});
type SocialInput = z.infer<typeof socialInput>;

interface SocialPost {
  channel: string;
  text: { en: string; ja: string };
}

export const socialDraftPosts: ToolDefinition<
  SocialInput,
  { posts: SocialPost[]; autoPosted: false }
> = {
  name: 'social.draft_posts',
  tier: 'auto',
  surfaces: ['copilot'],
  input: socialInput,
  summarize: (i) => ({
    en: `Draft social posts for cohort ${i.cohortId.slice(0, 8)} (${i.channels.join(', ')})`,
    ja: `コホート ${i.cohortId.slice(0, 8)} のSNS投稿を下書き（${i.channels.join('、')}）`,
  }),
  handler: async (ctx, i) => {
    const cohort = await ctx.tx.cohort.findUnique({
      where: { id: i.cohortId },
      include: { workshop: true },
    });
    if (!cohort) throw new NotFoundError('Cohort', i.cohortId);
    const title = titleOf(cohort.workshop);
    const posts: SocialPost[] = i.channels.map((channel) => ({
      channel,
      text: {
        en: `Enrollment is open for ${title.en}. Hands-on, small-group, and immediately useful. Reserve your seat.`,
        ja: `${title.ja}の受付を開始しました。少人数・実践重視ですぐに役立ちます。お早めにどうぞ。`,
      },
    }));
    // Spec §6: drafts only, a human posts. We never call any social API here.
    return { posts, autoPosted: false };
  },
};
