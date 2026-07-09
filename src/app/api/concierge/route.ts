import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/server/auth/session';
import { runConcierge, type ConciergeContext } from '@/server/ai/concierge';
import { toErrorResponse } from '@/server/http';
import { enforceRateLimit, RATE_LIMITS } from '@/server/rate-limit';

// POST /api/concierge — PUBLIC concierge chatbot (COPILOT_TOOLS §7). No auth
// required (anonymous visitors welcome); if a session cookie is present the
// concierge runs as that participant so enrollment.begin_checkout can create a
// real order. The concierge can ONLY call §7 tools — every tool call is routed
// through assertSurfaceAllowed(name,'concierge') in the runner, so a copilot-only
// tool is structurally impossible to invoke. It always self-identifies as AI.
const body = z.object({
  message: z.string().trim().min(1).max(2000),
  sessionKey: z.string().trim().max(200).optional(),
  locale: z.enum(['en', 'ja']).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const limited = enforceRateLimit(req, RATE_LIMITS.concierge);
    if (limited) return limited;

    const parsed = body.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 });
    }

    // Optional identity — anonymous is allowed. Never elevate off the message.
    const session = await getSession();
    const locale = parsed.data.locale ?? session?.locale ?? 'en';

    const ctx: ConciergeContext = {
      session,
      locale,
      sessionKey: parsed.data.sessionKey,
    };

    const reply = await runConcierge(ctx, parsed.data.message);

    return NextResponse.json({
      message: reply.message,
      isAi: reply.isAi,
      toolCalls: reply.toolCalls.map((c) => ({ tool: c.tool })),
      provider: reply.provider,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
