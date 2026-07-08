import 'server-only';
import type { Currency, PromoCode, Prisma } from '@/generated/prisma';
import { InvalidStateError } from './errors';

// ─────────────────────────────────────────────────────────────────────────────
// Server-side commerce math (the money invariant, CLAUDE.md #3). Client totals
// are NEVER trusted; totals/tax/discount are computed here in integer minor
// units. JPY has no minor units (yen); USD is cents.
// ─────────────────────────────────────────────────────────────────────────────

/** 10% Japanese consumption tax applies to JPY orders only. */
export const CONSUMPTION_TAX_RATE = 0.1;

export interface LineItem {
  /** minor units (JPY yen; USD cents) */
  unitPrice: number;
  qty: number;
}

export interface OrderTotals {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
}

/** A promo pre-validated against the order (window, scope, currency, limits). */
export type ApplicablePromo = Pick<PromoCode, 'type' | 'value' | 'currency'>;

/** Discount for a promo against a subtotal, in minor units, floored to an
 * integer and clamped to [0, subtotal]. `value` semantics:
 *   • percent / early_bird / seat_limited → whole percent (20 == 20%)
 *   • fixed / referral                    → minor units in the order currency
 * (See PRODUCT_SPEC §4.3; DECISIONS records the "whole percent" reading.) */
export function promoDiscount(promo: ApplicablePromo, subtotal: number): number {
  let raw: number;
  switch (promo.type) {
    case 'percent':
    case 'early_bird':
    case 'seat_limited':
      raw = Math.round((promo.value / 100) * subtotal);
      break;
    case 'fixed':
    case 'referral':
      raw = promo.value;
      break;
    default:
      raw = 0;
  }
  return Math.max(0, Math.min(raw, subtotal));
}

/** Consumption tax on the taxable base (subtotal − discount). JPY only. */
export function computeTax(currency: Currency, taxableBase: number): number {
  if (currency !== 'JPY') return 0;
  return Math.round(CONSUMPTION_TAX_RATE * Math.max(0, taxableBase));
}

/**
 * Compute an order's money in minor units, entirely server-side.
 *   subtotal = Σ unitPrice·qty
 *   discount = promo applied to subtotal (0 if none)
 *   tax      = 10% of (subtotal − discount) for JPY, else 0
 *   total    = subtotal − discount + tax
 */
export function computeOrderTotals(args: {
  items: LineItem[];
  currency: Currency;
  promo?: ApplicablePromo | null;
}): OrderTotals {
  const subtotal = args.items.reduce((sum, i) => sum + i.unitPrice * i.qty, 0);
  const discount = args.promo ? promoDiscount(args.promo, subtotal) : 0;
  const taxableBase = subtotal - discount;
  const tax = computeTax(args.currency, taxableBase);
  const total = subtotal - discount + tax;
  return { subtotal, discount, tax, total };
}

// ── Promo validation ─────────────────────────────────────────────────────────

export type PromoRejectReason =
  'not_found' | 'not_yet_valid' | 'expired' | 'currency_mismatch' | 'out_of_scope' | 'exhausted';

export class PromoInvalidError extends InvalidStateError {
  constructor(public readonly reason: PromoRejectReason) {
    super(`Promo code cannot be applied: ${reason}`);
    this.name = 'PromoInvalidError';
  }
}

/**
 * Validate a promo against an order context WITHOUT mutating redeemed_count.
 * Redemption count is atomically claimed at checkout time (see claimPromo) so
 * the `redeemed_count < max_redemptions` limit holds under concurrency
 * (DATA_MODEL §8). Returns nothing on success; throws PromoInvalidError.
 */
export function assertPromoApplicable(
  promo: PromoCode,
  ctx: { currency: Currency; cohortId?: string | null; now?: Date },
): void {
  const now = ctx.now ?? new Date();

  if (promo.validFrom && now < promo.validFrom) throw new PromoInvalidError('not_yet_valid');
  if (promo.validUntil && now > promo.validUntil) throw new PromoInvalidError('expired');

  // A currency-scoped promo (typically fixed-amount) must match the order.
  if (promo.currency && promo.currency !== ctx.currency) {
    throw new PromoInvalidError('currency_mismatch');
  }

  // cohort_scope: empty array = unscoped; otherwise the order's cohort must be in it.
  if (promo.cohortScope.length > 0) {
    if (!ctx.cohortId || !promo.cohortScope.includes(ctx.cohortId)) {
      throw new PromoInvalidError('out_of_scope');
    }
  }

  if (promo.maxRedemptions !== null && promo.redeemedCount >= promo.maxRedemptions) {
    throw new PromoInvalidError('exhausted');
  }
}

/**
 * Atomically claim one redemption of a promo inside the checkout transaction.
 * The conditional `updateMany` (redeemed_count < max_redemptions) is the
 * enforcement point for `seat_limited` and any capped code — if the row was
 * already at its cap the update matches 0 rows and we reject. Uncapped codes
 * (max_redemptions null) always increment. Enforced in the transaction, not
 * just app code (DATA_MODEL §8).
 */
export async function claimPromo(tx: Prisma.TransactionClient, promoId: string): Promise<void> {
  const promo = await tx.promoCode.findUnique({ where: { id: promoId } });
  if (!promo) throw new PromoInvalidError('not_found');

  if (promo.maxRedemptions === null) {
    await tx.promoCode.update({
      where: { id: promoId },
      data: { redeemedCount: { increment: 1 } },
    });
    return;
  }

  const claimed = await tx.promoCode.updateMany({
    where: { id: promoId, redeemedCount: { lt: promo.maxRedemptions } },
    data: { redeemedCount: { increment: 1 } },
  });
  if (claimed.count === 0) throw new PromoInvalidError('exhausted');
}
