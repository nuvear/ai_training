import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requestMagicLink } from '@/server/auth/magic-link';
import { toErrorResponse } from '@/server/http';
import { enforceRateLimit, RATE_LIMITS } from '@/server/rate-limit';

const body = z.object({ email: z.string().email() });

export async function POST(req: NextRequest) {
  try {
    const limited = enforceRateLimit(req, RATE_LIMITS.magicLink);
    if (limited) return limited;

    const parsed = body.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });
    }
    const result = await requestMagicLink(parsed.data.email);
    return NextResponse.json(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
