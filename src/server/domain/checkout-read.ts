import 'server-only';
import type { Currency } from '@/generated/prisma';
import { prisma } from '@/server/db/client';
import { NotFoundError, InvalidStateError } from './errors';
import {
  assertPromoApplicable,
  computeOrderTotals,
  PromoInvalidError,
  type ApplicablePromo,
  type PromoRejectReason,
} from './commerce';

// ─────────────────────────────────────────────────────────────────────────────
// Read-only helpers for the B2C checkout UI: load a cohort's purchase context
// and produce an authoritative money quote. All math delegates to
// computeOrderTotals (commerce.ts) — this file never invents totals. Workshops
// and cohorts are global (non-org) business data, so these read without a
// tenant context (mirrors src/server/domain/catalog.ts).
// ─────────────────────────────────────────────────────────────────────────────

type Bilingual = { en?: string; ja?: string };

export interface CheckoutContext {
  cohortId: string;
  workshopTitle: Bilingual;
  workshopLevel: string;
  startsAt: Date;
  endsAt: Date;
  priceJpy: number | null;
  priceUsd: number | null;
}

/** Load the workshop title + cohort dates/price for the checkout page shell. */
export async function loadCheckoutContext(cohortId: string): Promise<CheckoutContext | null> {
  const cohort = await prisma.cohort.findFirst({
    where: { id: cohortId, status: { in: ['open', 'full'] }, workshop: { status: 'published' } },
    include: { workshop: { select: { title: true, level: true } } },
  });
  if (!cohort) return null;
  return {
    cohortId: cohort.id,
    workshopTitle: (cohort.workshop.title as Bilingual) ?? {},
    workshopLevel: cohort.workshop.level,
    startsAt: cohort.startsAt,
    endsAt: cohort.endsAt,
    priceJpy: cohort.priceJpy,
    priceUsd: cohort.priceUsd,
  };
}

function unitPriceFor(
  cohort: { priceJpy: number | null; priceUsd: number | null },
  currency: Currency,
): number {
  const price = currency === 'JPY' ? cohort.priceJpy : cohort.priceUsd;
  if (price === null || price === undefined) {
    throw new InvalidStateError(`Cohort has no ${currency} price`);
  }
  return price;
}

export interface OrderQuote {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  currency: Currency;
  /** Set when a submitted promo code could not be applied (UI shows a note). */
  promoError?: PromoRejectReason;
}

/**
 * Authoritative order-summary quote for a single cohort seat. Mirrors the money
 * path of beginCheckout (same computeOrderTotals + assertPromoApplicable) but
 * WITHOUT persisting anything or claiming a redemption. If the promo is invalid
 * we return totals without a discount plus `promoError` so the UI can surface
 * the reason rather than 500.
 */
export async function quoteCohortOrder(args: {
  cohortId: string;
  currency: Currency;
  promoCode?: string;
}): Promise<OrderQuote> {
  const cohort = await prisma.cohort.findFirst({
    where: {
      id: args.cohortId,
      status: { in: ['open', 'full'] },
      workshop: { status: 'published' },
    },
    select: { id: true, priceJpy: true, priceUsd: true },
  });
  if (!cohort) throw new NotFoundError('Cohort', args.cohortId);

  const unitPrice = unitPriceFor(cohort, args.currency);
  const items = [{ unitPrice, qty: 1 }];

  let promo: ApplicablePromo | null = null;
  let promoError: PromoRejectReason | undefined;

  if (args.promoCode) {
    const found = await prisma.promoCode.findUnique({ where: { code: args.promoCode } });
    if (!found) {
      promoError = 'not_found';
    } else {
      try {
        assertPromoApplicable(found, { currency: args.currency, cohortId: cohort.id });
        promo = { type: found.type, value: found.value, currency: found.currency };
      } catch (err) {
        if (err instanceof PromoInvalidError) promoError = err.reason;
        else throw err;
      }
    }
  }

  const totals = computeOrderTotals({ items, currency: args.currency, promo });
  return { ...totals, currency: args.currency, promoError };
}
