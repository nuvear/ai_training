import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireSession } from '@/server/auth/rbac';
import { beginCheckout } from '@/server/domain/checkout';
import type { CheckoutMethod } from '@/server/payments/provider';
import { toErrorResponse } from '@/server/http';
import { NotFoundError, InvalidStateError } from '@/server/domain/errors';

// ─────────────────────────────────────────────────────────────────────────────
// B2C checkout entry point (M2). A signed-in buyer of ANY role may purchase a
// cohort seat. Money is computed server-side inside beginCheckout — the client
// never sends amounts. We return { orderId, checkoutUrl } and the browser
// redirects to Airwallex's hosted page (invariant 4: no card data on our
// servers).
// ─────────────────────────────────────────────────────────────────────────────

const body = z.object({
  cohortId: z.string().uuid(),
  currency: z.enum(['JPY', 'USD']),
  promoCode: z.string().min(1).optional(),
  method: z.enum(['card', 'konbini', 'bank_transfer']),
});

/**
 * Map a UI payment-method choice to the provider methods offered on the hosted
 * checkout. The provider abstraction supports `card` and `konbini`; the mock's
 * "Invoice / bank transfer (orgs)" option is settled through the card-family
 * hosted page for individual B2C orders until a dedicated transfer method
 * exists, so it maps to `['card']`.
 */
const METHOD_MAP: Record<'card' | 'konbini' | 'bank_transfer', CheckoutMethod[]> = {
  card: ['card'],
  konbini: ['konbini'],
  bank_transfer: ['card'],
};

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const parsed = body.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid checkout request' }, { status: 400 });
    }

    const { orderId, checkoutUrl } = await beginCheckout({
      session,
      kind: 'individual_enrollment',
      cohortId: parsed.data.cohortId,
      currency: parsed.data.currency,
      promoCode: parsed.data.promoCode,
      methods: METHOD_MAP[parsed.data.method],
    });

    return NextResponse.json({ orderId, checkoutUrl });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof InvalidStateError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return toErrorResponse(err);
  }
}
