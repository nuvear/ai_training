import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireRole, STAFF_ROLES } from '@/server/auth/rbac';
import { planCommand } from '@/server/ai/orchestrator';
import { toErrorResponse } from '@/server/http';

const body = z.object({
  command: z.string().trim().min(1).max(500),
  locale: z.enum(['en', 'ja']).optional(),
});

/**
 * The copilot console posts a natural-language command here. The orchestrator
 * turns it into a PLAN: a parent `copilot.plan` ai_action plus one proposed
 * child ai_action per step (tier read from the server registry). Nothing is
 * executed here — the client previews the plan, then calls /run to execute the
 * auto steps and queue the approve/owner steps.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole(...STAFF_ROLES);
    const parsed = body.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'A command is required' }, { status: 400 });
    }

    const locale = parsed.data.locale ?? session.locale;
    const plan = await planCommand(session, parsed.data.command, locale);
    return NextResponse.json({
      parentId: plan.parentId,
      recognized: plan.steps.length > 0,
      steps: plan.steps,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
