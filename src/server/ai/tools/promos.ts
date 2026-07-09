import { z } from 'zod';
import type { PromoType } from '@/generated/prisma';
import type { ToolDefinition } from '../types';
import { NotFoundError } from '@/server/domain/errors';

// Promo tools (COPILOT_TOOLS §3): suggest (auto, no writes), create (approve),
// deactivate (auto, safety valve).

const promoTypeEnum = z.enum(['percent', 'fixed', 'early_bird', 'seat_limited', 'referral']);
const currencyEnum = z.enum(['JPY', 'USD']);

// ── promo.suggest — returns proposals only, never writes (COPILOT_TOOLS §3) ──
const suggestInput = z.object({
  cohortId: z.string().uuid(),
  objective: z.enum(['fill_seats', 'early_bird', 'referral']).default('fill_seats'),
});
type SuggestInput = z.infer<typeof suggestInput>;

interface PromoProposal {
  code: string;
  type: PromoType;
  value: number;
  rationale: { en: string; ja: string };
}

export const promoSuggest: ToolDefinition<SuggestInput, { proposals: PromoProposal[] }> = {
  name: 'promo.suggest',
  tier: 'auto',
  surfaces: ['copilot'],
  input: suggestInput,
  summarize: (i) => ({
    en: `Suggest promos for cohort ${i.cohortId.slice(0, 8)} (${i.objective})`,
    ja: `コホート ${i.cohortId.slice(0, 8)} の割引案（${i.objective}）`,
  }),
  handler: async (ctx, i) => {
    const cohort = await ctx.tx.cohort.findUnique({ where: { id: i.cohortId } });
    if (!cohort) throw new NotFoundError('Cohort', i.cohortId);
    // Deterministic, evidence-free proposals (predictive inputs land in M5).
    // No writes: the owner reviews these and calls promo.create to commit.
    const proposals: PromoProposal[] =
      i.objective === 'early_bird'
        ? [
            {
              code: 'HAYAWARI20',
              type: 'early_bird',
              value: 20,
              rationale: {
                en: '20% early-bird to pull demand forward before the cohort fills.',
                ja: '定員に達する前に需要を前倒しする20%の早割です。',
              },
            },
          ]
        : i.objective === 'referral'
          ? [
              {
                code: 'FRIEND15',
                type: 'referral',
                value: 15,
                rationale: {
                  en: '15% referral incentive to activate word-of-mouth.',
                  ja: '口コミを活性化する15%の紹介インセンティブです。',
                },
              },
            ]
          : [
              {
                code: 'LASTSEATS10',
                type: 'percent',
                value: 10,
                rationale: {
                  en: '10% off to convert the final undecided seats.',
                  ja: '残席を後押しする10%割引です。',
                },
              },
            ];
    return { proposals };
  },
};

// ── promo.create — approve-tier; owner/staff commit a code (COPILOT_TOOLS §3) ─
const createInput = z
  .object({
    code: z
      .string()
      .trim()
      .min(2)
      .max(40)
      .regex(/^[A-Za-z0-9_-]+$/, 'code must be alphanumeric/underscore/dash'),
    type: promoTypeEnum,
    /** whole percent for percent/early_bird/seat_limited; minor units for fixed/referral */
    value: z.number().int().positive(),
    currency: currencyEnum.optional(),
    maxRedemptions: z.number().int().positive().optional(),
    validFrom: z.string().datetime().optional(),
    validUntil: z.string().datetime().optional(),
    cohortScope: z.array(z.string().uuid()).default([]),
  })
  .refine((v) => v.type !== 'seat_limited' || v.maxRedemptions !== undefined, {
    message: 'seat_limited promos require maxRedemptions',
    path: ['maxRedemptions'],
  });
type CreateInput = z.infer<typeof createInput>;

export const promoCreate: ToolDefinition<CreateInput, { promoCodeId: string; code: string }> = {
  name: 'promo.create',
  tier: 'approve',
  surfaces: ['copilot'],
  input: createInput,
  summarize: (i) => ({
    en: `Create promo ${i.code} (${i.type})`,
    ja: `割引コード ${i.code}（${i.type}）を作成`,
  }),
  handler: async (ctx, i) => {
    const promo = await ctx.tx.promoCode.create({
      data: {
        code: i.code,
        type: i.type,
        value: i.value,
        currency: i.currency ?? null,
        maxRedemptions: i.maxRedemptions ?? null,
        validFrom: i.validFrom ? new Date(i.validFrom) : null,
        validUntil: i.validUntil ? new Date(i.validUntil) : null,
        cohortScope: i.cohortScope,
        // AI proposed → owner approved this via the ledger; mark provenance.
        createdBy: 'ai_approved',
      },
    });
    return { promoCodeId: promo.id, code: promo.code };
  },
};

// ── promo.deactivate — auto safety valve; expires a code now (COPILOT_TOOLS §3) ─
const deactivateInput = z.object({
  promoCodeId: z.string().uuid(),
  reason: z.string().trim().min(1).max(500),
});
type DeactivateInput = z.infer<typeof deactivateInput>;

export const promoDeactivate: ToolDefinition<
  DeactivateInput,
  { promoCodeId: string; deactivated: boolean }
> = {
  name: 'promo.deactivate',
  tier: 'auto',
  surfaces: ['copilot'],
  input: deactivateInput,
  summarize: (i) => ({
    en: `Deactivate promo ${i.promoCodeId.slice(0, 8)}: ${i.reason}`,
    ja: `割引コード ${i.promoCodeId.slice(0, 8)} を無効化：${i.reason}`,
  }),
  handler: async (ctx, i) => {
    const promo = await ctx.tx.promoCode.findUnique({ where: { id: i.promoCodeId } });
    if (!promo) throw new NotFoundError('PromoCode', i.promoCodeId);
    // Close the validity window immediately → assertPromoApplicable rejects it.
    await ctx.tx.promoCode.update({
      where: { id: i.promoCodeId },
      data: { validUntil: new Date(Date.now() - 1000) },
    });
    return { promoCodeId: i.promoCodeId, deactivated: true };
  },
};
