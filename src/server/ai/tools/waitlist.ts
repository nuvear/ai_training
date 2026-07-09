import { z } from 'zod';
import type { Prisma } from '@/generated/prisma';
import type { ToolDefinition } from '../types';
import { NotFoundError } from '@/server/domain/errors';

// Promoted people get a 24h window to confirm (PRODUCT_SPEC §3).
export const CONFIRM_WINDOW_MS = 24 * 60 * 60 * 1000;

type Client = Prisma.TransactionClient;

/**
 * Offers waitlist seats in AI-scored order (score desc, FIFO fallback). Each
 * offer opens a 24h confirm window. Returns the promoted entry ids.
 */
export async function promoteWaitlist(
  tx: Client,
  cohortId: string,
  n?: number,
): Promise<{ id: string; userId: string; expiresAt: Date }[]> {
  const waiting = await tx.waitlistEntry.findMany({
    where: { cohortId, status: 'waiting' },
    orderBy: [{ aiAttendScore: { sort: 'desc', nulls: 'last' } }, { position: 'asc' }],
  });
  const toPromote = typeof n === 'number' ? waiting.slice(0, Math.max(0, n)) : waiting;

  const now = new Date();
  const expiresAt = new Date(now.getTime() + CONFIRM_WINDOW_MS);

  for (const entry of toPromote) {
    await tx.waitlistEntry.update({
      where: { id: entry.id },
      data: { status: 'offered', promotedAt: now, expiresAt },
    });
  }
  return toPromote.map((e) => ({ id: e.id, userId: e.userId, expiresAt }));
}

/** Expires offers whose 24h confirm window has passed. Returns the count. */
export async function expireWaitlistOffers(tx: Client, cohortId?: string): Promise<number> {
  const res = await tx.waitlistEntry.updateMany({
    where: {
      status: 'offered',
      expiresAt: { lt: new Date() },
      ...(cohortId ? { cohortId } : {}),
    },
    data: { status: 'expired' },
  });
  return res.count;
}

const promoteInput = z.object({
  cohortId: z.string().uuid(),
  n: z.number().int().positive().optional(),
});
type PromoteInput = z.infer<typeof promoteInput>;

export const waitlistPromote: ToolDefinition<
  PromoteInput,
  { promoted: number; expiresAt?: string }
> = {
  name: 'waitlist.promote',
  tier: 'auto',
  surfaces: ['copilot', 'scheduler'],
  input: promoteInput,
  summarize: (i) => ({
    en: `Promote ${i.n ?? 'all'} from cohort ${i.cohortId.slice(0, 8)} waitlist`,
    ja: `コホート ${i.cohortId.slice(0, 8)} のキャンセル待ちから${i.n ?? '全員'}を繰り上げ`,
  }),
  handler: async (ctx, i) => {
    const cohort = await ctx.tx.cohort.findUnique({ where: { id: i.cohortId } });
    if (!cohort) throw new NotFoundError('Cohort', i.cohortId);
    const promoted = await promoteWaitlist(ctx.tx, i.cohortId, i.n);
    return {
      promoted: promoted.length,
      expiresAt: promoted[0]?.expiresAt.toISOString(),
    };
  },
};
