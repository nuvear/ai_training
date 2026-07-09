import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireSession } from '@/server/auth/rbac';
import { toErrorResponse } from '@/server/http';
import { quoteCohortOrder } from '@/server/domain/checkout-read';
import { NotFoundError, InvalidStateError } from '@/server/domain/errors';

// ─────────────────────────────────────────────────────────────────────────────
// Authoritative order-summary preview. The client renders totals from THIS
// response only — it never computes money itself (invariant 3). Recomputed on
// every promo-code apply so the discount/tax/total shown match what
// beginCheckout will persist.
// ─────────────────────────────────────────────────────────────────────────────

const body = z.object({
  cohortId: z.string().uuid(),
  currency: z.enum(['JPY', 'USD']),
  promoCode: z.string().min(1).optional(),
});

export async function POST(req: NextRequest) {
  try {
    await requireSession();
    const parsed = body.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid quote request' }, { status: 400 });
    }

    const quote = await quoteCohortOrder(parsed.data);
    return NextResponse.json(quote);
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
