import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireSession, AuthError } from '@/server/auth/rbac';
import { getTool } from '@/server/ai/registry';
import { proposeAction, proposeAndAutoExecute, effectiveTier } from '@/server/ai/ledger';
import { allowedInvokeRoles } from '@/server/ai/authz';
import { toErrorResponse } from '@/server/http';

const body = z.object({
  toolName: z.string().min(1),
  input: z.unknown().default({}),
  idempotencyKey: z.string().uuid().optional(),
});

/**
 * The single internal entry point for invoking a copilot tool from the UI. Auto-
 * tier tools execute immediately and return their output; approve/owner-tier
 * tools are written to the ledger as `proposed` and wait in the approval queue.
 * Tier is read from the server registry — the caller cannot choose it.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const parsed = body.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'toolName and input are required' }, { status: 400 });
    }

    const def = getTool(parsed.data.toolName); // throws unknown_tool → 404

    // Role gate depends on the tool: staff by default, org_admin for the allowlist.
    const allowedRoles = allowedInvokeRoles(def.name);
    if (!allowedRoles.includes(session.role)) {
      throw new AuthError(403, `Requires role: ${allowedRoles.join(' | ')}`);
    }

    const args = {
      surface: 'copilot' as const,
      toolName: def.name,
      input: parsed.data.input,
      idempotencyKey: parsed.data.idempotencyKey,
    };

    // Resolve the effective tier for THIS input (dynamic tiers included) so a
    // dynamic tool routes to auto-execute vs. the approval queue correctly.
    const validated = def.input.safeParse(parsed.data.input);
    const tier = validated.success ? effectiveTier(def, validated.data) : def.tier;

    if (tier === 'auto') {
      const action = await proposeAndAutoExecute(session, args);
      return NextResponse.json({
        actionId: action.id,
        status: action.status,
        output: action.output,
      });
    }

    const action = await proposeAction(session, args);
    return NextResponse.json({
      actionId: action.id,
      status: action.status,
      tier: action.tier,
      requiresApproval: true,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
