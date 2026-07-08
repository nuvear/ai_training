import { z } from 'zod';
import type { ToolDefinition } from '../types';
import { NotFoundError, InvalidStateError } from '@/server/domain/errors';

// pricing.change (COPILOT_TOOLS §4) — owner-only; changes a cohort's dual price.

const changeInput = z
  .object({
    cohortId: z.string().uuid(),
    priceJpy: z.number().int().nonnegative().optional(),
    priceUsd: z.number().int().nonnegative().nullable().optional(),
  })
  .refine((v) => v.priceJpy !== undefined || v.priceUsd !== undefined, {
    message: 'Provide at least one of priceJpy or priceUsd',
  });
type ChangeInput = z.infer<typeof changeInput>;

export const pricingChange: ToolDefinition<
  ChangeInput,
  { cohortId: string; priceJpy: number | null; priceUsd: number | null }
> = {
  name: 'pricing.change',
  tier: 'owner_only',
  surfaces: ['copilot'],
  input: changeInput,
  summarize: (i) => ({
    en: `Change pricing for cohort ${i.cohortId.slice(0, 8)}`,
    ja: `コホート ${i.cohortId.slice(0, 8)} の価格を変更`,
  }),
  handler: async (ctx, i) => {
    const cohort = await ctx.tx.cohort.findUnique({ where: { id: i.cohortId } });
    if (!cohort) throw new NotFoundError('Cohort', i.cohortId);
    const priceJpy = i.priceJpy ?? cohort.priceJpy;
    if (priceJpy === null) {
      throw new InvalidStateError('A cohort must retain a JPY price');
    }
    const updated = await ctx.tx.cohort.update({
      where: { id: i.cohortId },
      data: {
        priceJpy,
        ...(i.priceUsd !== undefined ? { priceUsd: i.priceUsd } : {}),
      },
    });
    return { cohortId: updated.id, priceJpy: updated.priceJpy, priceUsd: updated.priceUsd };
  },
};
