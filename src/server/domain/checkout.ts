import 'server-only';
import type { Currency, PaymentProvider as PaymentProviderEnum, Prisma } from '@/generated/prisma';
import type { SessionUser } from '@/server/auth/session';
import { withOrgContext, tenantContext } from '@/server/db/rls';
import { getPaymentProvider } from '@/server/payments';
import type { CheckoutMethod } from '@/server/payments/provider';
import { NotFoundError, InvalidStateError } from './errors';
import { assertPromoApplicable, claimPromo, computeOrderTotals, type LineItem } from './commerce';

// ─────────────────────────────────────────────────────────────────────────────
// beginCheckout — the single server path that turns intent into a pending Order
// + OrderItem, computes money server-side, opens a provider-hosted checkout, and
// records a pending Payment carrying the providerRef (the webhook idempotency
// anchor). UI routes and the concierge `enrollment.begin_checkout` tool both call
// this; they never compute totals or touch the provider directly.
// ─────────────────────────────────────────────────────────────────────────────

export interface SeatPoolSpec {
  organizationId: string;
  seats: number;
  /** minor units per seat, in `currency` */
  unitPrice: number;
  /** ISO date the pool is valid until */
  validUntil: string;
  /** optional workshop/level label snapshot */
  label?: { en?: string; ja?: string };
}

export interface BeginCheckoutArgs {
  session: SessionUser;
  kind: 'individual_enrollment' | 'seat_pool';
  cohortId?: string;
  seatPoolSpec?: SeatPoolSpec;
  currency: Currency;
  promoCode?: string;
  methods: CheckoutMethod[];
  /** attribution snapshot */
  utm?: Record<string, string>;
}

export interface BeginCheckoutResult {
  orderId: string;
  checkoutUrl: string;
  total: number;
  currency: Currency;
}

function cohortPrice(
  cohort: { priceJpy: number | null; priceUsd: number | null },
  currency: Currency,
): number {
  const price = currency === 'JPY' ? cohort.priceJpy : cohort.priceUsd;
  if (price === null || price === undefined) {
    throw new InvalidStateError(`Cohort has no ${currency} price`);
  }
  return price;
}

/** card → airwallex_card; konbini → airwallex_konbini. The pending Payment's
 * provider column records the primary method offered. */
function providerEnumFor(methods: CheckoutMethod[]): PaymentProviderEnum {
  return methods.includes('konbini') && !methods.includes('card')
    ? 'airwallex_konbini'
    : 'airwallex_card';
}

export async function beginCheckout(args: BeginCheckoutArgs): Promise<BeginCheckoutResult> {
  const { session } = args;
  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';

  return withOrgContext(tenantContext(session), async (tx) => {
    // 1. Resolve line items + optional cohort/promo scope.
    let items: LineItem[];
    let cohortId: string | null = null;
    let organizationId: string | null = null;

    if (args.kind === 'individual_enrollment') {
      if (!args.cohortId) throw new InvalidStateError('cohortId required for enrollment');
      const cohort = await tx.cohort.findUnique({ where: { id: args.cohortId } });
      if (!cohort) throw new NotFoundError('Cohort', args.cohortId);
      cohortId = cohort.id;
      items = [{ unitPrice: cohortPrice(cohort, args.currency), qty: 1 }];
    } else {
      const spec = args.seatPoolSpec;
      if (!spec) throw new InvalidStateError('seatPoolSpec required for seat_pool');
      organizationId = spec.organizationId;
      items = [{ unitPrice: spec.unitPrice, qty: spec.seats }];
    }

    // 2. Validate + resolve the promo (one code max — PRODUCT_SPEC §4.3).
    let promoId: string | null = null;
    let promoForTotals = null as Parameters<typeof computeOrderTotals>[0]['promo'];
    if (args.promoCode) {
      const promo = await tx.promoCode.findUnique({ where: { code: args.promoCode } });
      if (!promo) throw new NotFoundError('PromoCode', args.promoCode);
      assertPromoApplicable(promo, { currency: args.currency, cohortId });
      promoId = promo.id;
      promoForTotals = { type: promo.type, value: promo.value, currency: promo.currency };
    }

    // 3. Compute money server-side.
    const [line] = items; // exactly one line item in M2 (enrollment or seat pool)
    if (!line) throw new InvalidStateError('No line item to check out');
    const totals = computeOrderTotals({ items, currency: args.currency, promo: promoForTotals });

    // 4. Atomically claim the promo redemption (seat_limited / capped codes).
    if (promoId) await claimPromo(tx, promoId);

    // 5. Persist the pending Order + OrderItem.
    const order = await tx.order.create({
      data: {
        buyerUserId: session.userId,
        organizationId,
        kind: args.kind,
        status: 'pending',
        currency: args.currency,
        subtotal: totals.subtotal,
        discount: totals.discount,
        tax: totals.tax,
        total: totals.total,
        promoCodeId: promoId,
        utm: args.utm ?? undefined,
      },
    });

    await tx.orderItem.create({
      data: {
        orderId: order.id,
        cohortId,
        seatPoolSpec:
          args.kind === 'seat_pool'
            ? (args.seatPoolSpec as unknown as Prisma.InputJsonValue)
            : undefined,
        qty: line.qty,
        unitPrice: line.unitPrice,
      },
    });

    // 6. Open the provider-hosted checkout and record a pending Payment.
    const provider = getPaymentProvider();
    const checkout = await provider.createHostedCheckout({
      orderId: order.id,
      amountMinor: totals.total,
      currency: args.currency,
      methods: args.methods,
      successUrl: `${appUrl}/checkout/success?order=${order.id}`,
      failUrl: `${appUrl}/checkout/failed?order=${order.id}`,
      customerEmail: session.email,
    });

    await tx.payment.create({
      data: {
        orderId: order.id,
        provider: providerEnumFor(args.methods),
        providerRef: checkout.providerRef,
        status: 'pending',
        amount: totals.total,
      },
    });

    return {
      orderId: order.id,
      checkoutUrl: checkout.checkoutUrl,
      total: totals.total,
      currency: args.currency,
    };
  });
}
