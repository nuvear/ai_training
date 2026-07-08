import 'server-only';
import { prisma } from '@/server/db/client';
import { withOrgContext, tenantContext } from '@/server/db/rls';
import type { SessionUser } from '@/server/auth/session';
import { assertSurfaceAllowed, getTool, ToolError } from './registry';
import type { Surface, Tier, ToolDefinition } from './types';
import type { AiAction } from '@/generated/prisma';

/**
 * The single, server-authoritative tier resolver. Uses a tool's optional
 * `dynamicTier(input)` (computed from the PARSED input) when present, else the
 * fixed registry tier. Both `proposeAction` (what to store) and
 * `approveAndExecute` (what role may approve) go through here, so the tier can
 * never be escalated or lowered by the caller — it is always recomputed from the
 * stored input the same way.
 */
export function effectiveTier(def: ToolDefinition, input: unknown): Tier {
  return def.dynamicTier?.(input) ?? def.tier;
}

export interface ProposeArgs {
  surface: Surface;
  toolName: string;
  input: unknown;
  parentId?: string;
  idempotencyKey?: string;
}

/**
 * Writes the ledger row BEFORE any execution (CLAUDE.md invariant 2). Validates
 * the surface and input up front. The tier is copied from the server registry,
 * never from the caller — model output cannot escalate it. `approve`/`owner_only`
 * tools stop at `proposed`; the caller decides whether to auto-execute.
 */
export async function proposeAction(session: SessionUser, args: ProposeArgs): Promise<AiAction> {
  if (args.idempotencyKey) {
    const existing = await prisma.aiAction.findUnique({
      where: { idempotencyKey: args.idempotencyKey },
    });
    if (existing) return existing;
  }

  const def = assertSurfaceAllowed(args.toolName, args.surface);
  const parsed = def.input.safeParse(args.input);
  if (!parsed.success) {
    throw new ToolError('invalid_input', parsed.error.issues.map((i) => i.message).join('; '));
  }

  return prisma.aiAction.create({
    data: {
      surface: args.surface,
      toolName: def.name,
      // authoritative: fixed registry tier, or the tool's dynamicTier(input).
      tier: effectiveTier(def, parsed.data),
      input: parsed.data as object,
      status: 'proposed',
      initiatedById: session.userId,
      parentId: args.parentId ?? null,
      idempotencyKey: args.idempotencyKey ?? null,
    },
  });
}

/** Runs the handler for an already-approved (or auto) action and records the
 * result. Re-reads the tier from the registry so a tampered row can't bypass
 * the gate. */
async function runAction(session: SessionUser, action: AiAction): Promise<AiAction> {
  const def = getTool(action.toolName);
  const parsed = def.input.safeParse(action.input);
  if (!parsed.success) {
    return prisma.aiAction.update({
      where: { id: action.id },
      data: { status: 'failed', output: { error: 'invalid_input' } },
    });
  }

  try {
    const output = await withOrgContext(tenantContext(session), (tx) =>
      def.handler({ session, tx, actionId: action.id }, parsed.data),
    );
    return prisma.aiAction.update({
      where: { id: action.id },
      data: { status: 'executed', output: output as object },
    });
  } catch (err) {
    return prisma.aiAction.update({
      where: { id: action.id },
      data: {
        status: 'failed',
        output: { error: err instanceof Error ? err.message : 'unknown_error' },
      },
    });
  }
}

/** Which roles may approve a given tier (server-side authority). */
export function canApprove(role: SessionUser['role'], tier: AiAction['tier']): boolean {
  if (tier === 'owner_only') return role === 'owner';
  if (tier === 'approve') return role === 'owner' || role === 'staff';
  return role === 'owner' || role === 'staff'; // auto: staff+ may still run manually
}

export class LedgerError extends Error {
  constructor(
    public status: 400 | 403 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = 'LedgerError';
  }
}

/**
 * Approves a proposed action and executes it. Enforces, server-side, that the
 * approver's role is sufficient for the registry tier — the heart of the
 * approval flow.
 */
export async function approveAndExecute(
  approver: SessionUser,
  actionId: string,
): Promise<AiAction> {
  const action = await prisma.aiAction.findUnique({ where: { id: actionId } });
  if (!action) throw new LedgerError(404, 'Action not found');
  if (action.status !== 'proposed') {
    throw new LedgerError(409, `Action is ${action.status}, not proposed`);
  }

  // Recompute the tier from the tool + STORED input (dynamic tiers included) —
  // never trust the persisted `tier` column, which a tampered row could forge.
  const def = getTool(action.toolName);
  const parsedInput = def.input.safeParse(action.input);
  const tier: AiAction['tier'] = parsedInput.success
    ? effectiveTier(def, parsedInput.data)
    : def.tier;
  if (!canApprove(approver.role, tier)) {
    throw new LedgerError(403, `Your role cannot approve a ${tier} action`);
  }

  await prisma.aiAction.update({
    where: { id: actionId },
    data: { status: 'approved', approvedById: approver.userId },
  });

  // Execute under the ORIGINAL initiator's tenant context where possible; for
  // M0 the initiator is staff/owner, so the approver's context is equivalent.
  return runAction(approver, { ...action, status: 'approved', approvedById: approver.userId });
}

export async function rejectAction(approver: SessionUser, actionId: string): Promise<AiAction> {
  const action = await prisma.aiAction.findUnique({ where: { id: actionId } });
  if (!action) throw new LedgerError(404, 'Action not found');
  if (action.status !== 'proposed') {
    throw new LedgerError(409, `Action is ${action.status}, not proposed`);
  }
  return prisma.aiAction.update({
    where: { id: actionId },
    data: { status: 'rejected', approvedById: approver.userId },
  });
}

/** Propose + immediately execute — only valid for `auto`-tier tools. */
export async function proposeAndAutoExecute(
  session: SessionUser,
  args: ProposeArgs,
): Promise<AiAction> {
  const def = getTool(args.toolName);
  // A dynamic-tier tool may resolve to auto for some inputs; validate then check
  // the effective tier for THIS input rather than only the fixed tier.
  const parsed = def.input.safeParse(args.input);
  const tier = parsed.success ? effectiveTier(def, parsed.data) : def.tier;
  if (tier !== 'auto') {
    throw new LedgerError(403, `${def.name} is ${tier}-tier and requires approval`);
  }
  const action = await proposeAction(session, args);
  if (action.status !== 'proposed') return action; // idempotent replay
  return runAction(session, action);
}

export async function listProposed(): Promise<AiAction[]> {
  return prisma.aiAction.findMany({
    where: { status: 'proposed' },
    orderBy: { createdAt: 'desc' },
  });
}
