import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/server/db/client';
import {
  computeOrderTotals,
  assertPromoApplicable,
  claimPromo,
  PromoInvalidError,
  type ApplicablePromo,
} from '@/server/domain/commerce';
import type { Currency, PromoCode } from '@/generated/prisma';

// The M2 money invariant: totals/tax/discount computed server-side in minor units.

const percent = (v: number): ApplicablePromo => ({ type: 'percent', value: v, currency: null });
const earlyBird = (v: number): ApplicablePromo => ({
  type: 'early_bird',
  value: v,
  currency: null,
});
const fixed = (v: number, c: Currency): ApplicablePromo => ({
  type: 'fixed',
  value: v,
  currency: c,
});

describe('computeOrderTotals — promo + consumption tax vectors', () => {
  it('HAYAWARI20: ¥45,000 −20% early_bird +10% tax = ¥39,600', () => {
    const t = computeOrderTotals({
      items: [{ unitPrice: 45_000, qty: 1 }],
      currency: 'JPY',
      promo: earlyBird(20),
    });
    expect(t.subtotal).toBe(45_000);
    expect(t.discount).toBe(9_000);
    expect(t.tax).toBe(3_600); // 10% of (45,000 − 9,000)
    expect(t.total).toBe(39_600);
  });

  it('USD order carries NO consumption tax', () => {
    const t = computeOrderTotals({
      items: [{ unitPrice: 31_000, qty: 1 }], // $310.00 in cents
      currency: 'USD',
      promo: percent(10),
    });
    expect(t.subtotal).toBe(31_000);
    expect(t.discount).toBe(3_100);
    expect(t.tax).toBe(0);
    expect(t.total).toBe(27_900);
  });

  it('fixed-amount promo (JPY minor units) then tax on the net', () => {
    const t = computeOrderTotals({
      items: [{ unitPrice: 45_000, qty: 1 }],
      currency: 'JPY',
      promo: fixed(5_000, 'JPY'),
    });
    expect(t.discount).toBe(5_000);
    expect(t.tax).toBe(4_000); // 10% of 40,000
    expect(t.total).toBe(44_000);
  });

  it('percent promo with quantity and JPY tax', () => {
    const t = computeOrderTotals({
      items: [{ unitPrice: 20_000, qty: 3 }],
      currency: 'JPY',
      promo: percent(25),
    });
    expect(t.subtotal).toBe(60_000);
    expect(t.discount).toBe(15_000);
    expect(t.tax).toBe(4_500); // 10% of 45,000
    expect(t.total).toBe(49_500);
  });

  it('no promo: JPY tax on the full subtotal', () => {
    const t = computeOrderTotals({ items: [{ unitPrice: 10_000, qty: 1 }], currency: 'JPY' });
    expect(t).toEqual({ subtotal: 10_000, discount: 0, tax: 1_000, total: 11_000 });
  });

  it('discount never exceeds subtotal', () => {
    const t = computeOrderTotals({
      items: [{ unitPrice: 3_000, qty: 1 }],
      currency: 'JPY',
      promo: fixed(9_999, 'JPY'),
    });
    expect(t.discount).toBe(3_000);
    expect(t.total).toBe(0);
  });
});

// ── DB-backed validation: window, currency, scope, redemption cap ────────────

const owner = { userId: randomUUID(), email: `promo-${randomUUID()}@t.local` };
const createdPromoIds: string[] = [];

beforeAll(async () => {
  await prisma.user.create({ data: { id: owner.userId, email: owner.email, role: 'owner' } });
});

afterAll(async () => {
  await prisma.promoCode.deleteMany({ where: { id: { in: createdPromoIds } } });
  await prisma.user.deleteMany({ where: { id: owner.userId } });
});

async function makePromo(data: Partial<PromoCode> & { code: string }): Promise<PromoCode> {
  const promo = await prisma.promoCode.create({
    data: {
      code: data.code,
      type: data.type ?? 'percent',
      value: data.value ?? 10,
      currency: data.currency ?? null,
      maxRedemptions: data.maxRedemptions ?? null,
      redeemedCount: data.redeemedCount ?? 0,
      validFrom: data.validFrom ?? null,
      validUntil: data.validUntil ?? null,
      cohortScope: data.cohortScope ?? [],
    },
  });
  createdPromoIds.push(promo.id);
  return promo;
}

describe('promo validation', () => {
  it('rejects an expired promo', async () => {
    const promo = await makePromo({
      code: `EXP-${randomUUID().slice(0, 8)}`,
      validUntil: new Date(Date.now() - 60_000),
    });
    expect(() => assertPromoApplicable(promo, { currency: 'JPY' })).toThrow(PromoInvalidError);
  });

  it('rejects a not-yet-valid promo', async () => {
    const promo = await makePromo({
      code: `FUT-${randomUUID().slice(0, 8)}`,
      validFrom: new Date(Date.now() + 60_000),
    });
    expect(() => assertPromoApplicable(promo, { currency: 'JPY' })).toThrow(PromoInvalidError);
  });

  it('rejects a currency mismatch', async () => {
    const promo = await makePromo({
      code: `CUR-${randomUUID().slice(0, 8)}`,
      type: 'fixed',
      value: 1_000,
      currency: 'USD',
    });
    expect(() => assertPromoApplicable(promo, { currency: 'JPY' })).toThrow(PromoInvalidError);
    expect(() => assertPromoApplicable(promo, { currency: 'USD' })).not.toThrow();
  });

  it('seat_limited respects max_redemptions under the transactional claim', async () => {
    const promo = await makePromo({
      code: `SEAT-${randomUUID().slice(0, 8)}`,
      type: 'seat_limited',
      value: 15,
      maxRedemptions: 2,
    });

    // Two claims succeed, the third is rejected — enforced in the transaction.
    await prisma.$transaction((tx) => claimPromo(tx, promo.id));
    await prisma.$transaction((tx) => claimPromo(tx, promo.id));
    await expect(prisma.$transaction((tx) => claimPromo(tx, promo.id))).rejects.toBeInstanceOf(
      PromoInvalidError,
    );

    const after = await prisma.promoCode.findUnique({ where: { id: promo.id } });
    expect(after?.redeemedCount).toBe(2);
    // And assertPromoApplicable now reports it exhausted.
    expect(() => assertPromoApplicable(after!, { currency: 'JPY' })).toThrow(PromoInvalidError);
  });
});
