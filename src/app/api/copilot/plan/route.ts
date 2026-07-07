import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireRole, STAFF_ROLES } from '@/server/auth/rbac';
import { proposeAction } from '@/server/ai/ledger';
import { getTool } from '@/server/ai/registry';
import { toErrorResponse } from '@/server/http';

const body = z.object({
  command: z.string().trim().min(1).max(500),
  idempotencyKey: z.string().uuid().optional(),
});

/**
 * The copilot console posts a natural-language command here. For M0 the only
 * recognized intent is "ping". Because workshop.ping is `approve`-tier, this
 * endpoint PROPOSES the action (writes the ledger row) but does NOT execute it —
 * that is the "blocked without approval" half of the flow.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole(...STAFF_ROLES);
    const parsed = body.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'A command is required' }, { status: 400 });
    }

    const command = parsed.data.command.toLowerCase();
    if (!command.includes('ping')) {
      return NextResponse.json({ recognized: false });
    }

    const action = await proposeAction(session, {
      surface: 'copilot',
      toolName: 'workshop.ping',
      input: { message: 'ping' },
      idempotencyKey: parsed.data.idempotencyKey,
    });

    const def = getTool(action.toolName);
    return NextResponse.json({
      recognized: true,
      plan: [
        {
          actionId: action.id,
          toolName: action.toolName,
          tier: action.tier,
          status: action.status,
          summary: def.summarize(action.input),
        },
      ],
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
