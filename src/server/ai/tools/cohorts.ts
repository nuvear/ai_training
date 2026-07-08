import { z } from 'zod';
import type { ToolDefinition } from '../types';
import { cohortFormatEnum } from '../schemas';
import { InvalidStateError, NotFoundError } from '@/server/domain/errors';

// Money: integer minor units + currency. JPY has no minor units (whole yen);
// USD is stored in cents. Totals/tax are computed server-side in M2.
const createInput = z
  .object({
    workshopId: z.string().uuid(),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    capacity: z.number().int().positive(),
    priceJpy: z.number().int().nonnegative(),
    priceUsd: z.number().int().nonnegative().optional(),
    format: cohortFormatEnum.default('online'),
    venue: z.object({ en: z.string(), ja: z.string() }).optional(),
    meetingUrl: z.string().url().optional(),
    facilitatorId: z.string().uuid().optional(),
  })
  .refine((v) => new Date(v.startsAt) < new Date(v.endsAt), {
    message: 'startsAt must be before endsAt',
    path: ['endsAt'],
  });
type CreateInput = z.infer<typeof createInput>;

export const cohortCreate: ToolDefinition<CreateInput, { cohortId: string }> = {
  name: 'cohort.create',
  tier: 'approve', // pricing makes this approve-tier
  surfaces: ['copilot'],
  input: createInput,
  summarize: (i) => ({
    en: `Schedule a cohort (cap ${i.capacity}, ¥${i.priceJpy.toLocaleString('en')})`,
    ja: `コホートを作成（定員${i.capacity}名・¥${i.priceJpy.toLocaleString('ja')}）`,
  }),
  handler: async (ctx, i) => {
    const workshop = await ctx.tx.workshop.findUnique({ where: { id: i.workshopId } });
    if (!workshop) throw new NotFoundError('Workshop', i.workshopId);
    const cohort = await ctx.tx.cohort.create({
      data: {
        workshopId: i.workshopId,
        startsAt: new Date(i.startsAt),
        endsAt: new Date(i.endsAt),
        capacity: i.capacity,
        priceJpy: i.priceJpy,
        priceUsd: i.priceUsd ?? null,
        format: i.format,
        venue: i.venue ?? undefined,
        meetingUrl: i.meetingUrl ?? null,
        facilitatorId: i.facilitatorId ?? null,
        status: 'open',
      },
    });
    return { cohortId: cohort.id };
  },
};

const cloneInput = z.object({
  cohortId: z.string().uuid(),
  newStartsAt: z.string().datetime(),
  newEndsAt: z.string().datetime(),
});
type CloneInput = z.infer<typeof cloneInput>;

export const cohortClone: ToolDefinition<CloneInput, { cohortId: string }> = {
  name: 'cohort.clone',
  tier: 'approve',
  surfaces: ['copilot'],
  input: cloneInput,
  summarize: (i) => ({
    en: `Clone cohort ${i.cohortId.slice(0, 8)} to new dates`,
    ja: `コホート ${i.cohortId.slice(0, 8)} を新しい日程で複製`,
  }),
  handler: async (ctx, i) => {
    const src = await ctx.tx.cohort.findUnique({ where: { id: i.cohortId } });
    if (!src) throw new NotFoundError('Cohort', i.cohortId);
    const clone = await ctx.tx.cohort.create({
      data: {
        workshopId: src.workshopId,
        startsAt: new Date(i.newStartsAt),
        endsAt: new Date(i.newEndsAt),
        capacity: src.capacity,
        priceJpy: src.priceJpy,
        priceUsd: src.priceUsd,
        format: src.format,
        venue: src.venue ?? undefined,
        meetingUrl: src.meetingUrl,
        facilitatorId: src.facilitatorId,
        status: 'open',
      },
    });
    return { cohortId: clone.id };
  },
};

const cancelInput = z.object({
  cohortId: z.string().uuid(),
  reason: z.string().trim().min(1).max(500),
});
type CancelInput = z.infer<typeof cancelInput>;

export const cohortCancel: ToolDefinition<CancelInput, { cohortId: string; status: string }> = {
  name: 'cohort.cancel',
  tier: 'owner_only', // triggers refund plan proposal (M2)
  surfaces: ['copilot'],
  input: cancelInput,
  summarize: (i) => ({
    en: `Cancel cohort ${i.cohortId.slice(0, 8)}: ${i.reason}`,
    ja: `コホート ${i.cohortId.slice(0, 8)} を中止：${i.reason}`,
  }),
  handler: async (ctx, i) => {
    const cohort = await ctx.tx.cohort.findUnique({ where: { id: i.cohortId } });
    if (!cohort) throw new NotFoundError('Cohort', i.cohortId);
    if (cohort.status === 'completed') {
      throw new InvalidStateError('Cannot cancel a completed cohort');
    }
    await ctx.tx.cohort.update({ where: { id: i.cohortId }, data: { status: 'cancelled' } });
    return { cohortId: i.cohortId, status: 'cancelled' };
  },
};
