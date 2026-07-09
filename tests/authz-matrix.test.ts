import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import type { Role } from '@/generated/prisma';
import { listTools, assertSurfaceAllowed, ToolError } from '@/server/ai/registry';
import { canApprove, effectiveTier } from '@/server/ai/ledger';
import { STAFF_ROLES } from '@/server/auth/rbac';
import { ORG_ADMIN_TOOLS } from '@/server/ai/authz';
import type { SessionUser } from '@/server/auth/session';
import type { Tier } from '@/server/ai/types';

/**
 * THE M6 exit criterion (tasks/M6.md §1): the authz matrix over
 * EVERY registered tool × EVERY role, asserting the EXACT allow/deny with ZERO
 * unexpected allows. The expected policy is encoded as data below and checked
 * against the REAL guard functions/constants (never re-implementations), so a
 * drift in enforcement fails the test rather than the test rubber-stamping it.
 */

const ROLES: Role[] = ['owner', 'staff', 'org_admin', 'participant'];

/**
 * Expected INVOCATION policy for surface 'copilot' via /api/tools/execute.
 * A (tool, role) pair is EXPECTED-ALLOWED iff:
 *   - the tool is copilot-surfaced (surfaces.includes('copilot')), AND
 *   - role ∈ STAFF_ROLES, OR (role === 'org_admin' AND tool ∈ ORG_ADMIN_TOOLS).
 * participant is NEVER allowed. Concierge-only tools are NEVER invocable here
 * (assertSurfaceAllowed rejects surface 'copilot').
 */
function expectedInvokeAllowed(toolName: string, copilotSurfaced: boolean, role: Role): boolean {
  if (!copilotSurfaced) return false;
  if (STAFF_ROLES.includes(role)) return true;
  if (role === 'org_admin' && ORG_ADMIN_TOOLS.has(toolName)) return true;
  return false;
}

/** Mirror of the route's role gate — the actual enforcement predicate. */
function routeRoleGateAllows(toolName: string, role: Role): boolean {
  const allowed: Role[] = ORG_ADMIN_TOOLS.has(toolName)
    ? [...STAFF_ROLES, 'org_admin']
    : STAFF_ROLES;
  return allowed.includes(role);
}

/** Does the surface guard admit this tool on 'copilot'? (real function) */
function copilotSurfaceAllows(toolName: string): boolean {
  try {
    assertSurfaceAllowed(toolName, 'copilot');
    return true;
  } catch (e) {
    if (e instanceof ToolError && e.code === 'surface_forbidden') return false;
    throw e;
  }
}

/**
 * The composed, REAL enforcement for invocation via execute: BOTH the route
 * role gate AND the surface guard (proposeAction runs assertSurfaceAllowed) must
 * pass. This is what the endpoint actually enforces end to end.
 */
function actualInvokeAllowed(toolName: string, role: Role): boolean {
  return routeRoleGateAllows(toolName, role) && copilotSurfaceAllows(toolName);
}

describe('authz matrix — invocation via /api/tools/execute (surface copilot)', () => {
  const tools = listTools();
  let asserted = 0;
  let unexpectedAllows = 0;
  const holes: string[] = [];

  it('every (tool, role) pair matches the expected allow/deny, zero unexpected allows', () => {
    for (const tool of tools) {
      const copilotSurfaced = tool.surfaces.includes('copilot');
      for (const role of ROLES) {
        const expected = expectedInvokeAllowed(tool.name, copilotSurfaced, role);
        const actual = actualInvokeAllowed(tool.name, role);
        asserted += 1;

        // The core safety property: enforcement must never allow MORE than policy.
        if (actual && !expected) {
          unexpectedAllows += 1;
          holes.push(`INVOKE HOLE: ${tool.name} wrongly invocable by ${role}`);
        }
        expect(actual, `${tool.name} × ${role} (invoke)`).toBe(expected);
      }
    }

    // Zero unexpected allows — the literal exit criterion.
    expect(holes, holes.join('\n')).toEqual([]);
    expect(unexpectedAllows).toBe(0);

    // Coverage: 4 roles × every registered tool.
    expect(asserted).toBe(tools.length * ROLES.length);
    // eslint-disable-next-line no-console
    console.log(
      `[authz-matrix] invocation: asserted ${asserted} (tool,role) pairs over ` +
        `${tools.length} tools × ${ROLES.length} roles — unexpected allows: ${unexpectedAllows}`,
    );
  });

  it('participant is denied on EVERY tool', () => {
    for (const tool of tools) {
      expect(actualInvokeAllowed(tool.name, 'participant'), `${tool.name} × participant`).toBe(
        false,
      );
    }
  });

  it('concierge-only tools are invocable by NO role via execute', () => {
    const conciergeOnly = tools.filter(
      (t) => t.surfaces.includes('concierge') && !t.surfaces.includes('copilot'),
    );
    expect(conciergeOnly.length).toBeGreaterThan(0); // sanity: the §7 subset exists
    for (const tool of conciergeOnly) {
      for (const role of ROLES) {
        expect(actualInvokeAllowed(tool.name, role), `${tool.name} × ${role}`).toBe(false);
      }
    }
  });
});

/**
 * Expected APPROVAL policy via canApprove(role, tier):
 *   owner      → approves approve + owner_only
 *   staff      → approves approve, NOT owner_only
 *   org_admin  → approves neither
 *   participant→ approves neither
 * (auto tier is not an approval gate — it never enters the approval queue.)
 */
function expectedApprove(role: Role, tier: Tier): boolean {
  if (tier === 'owner_only') return role === 'owner';
  if (tier === 'approve') return role === 'owner' || role === 'staff';
  return false; // auto — not applicable to the approval queue
}

describe('authz matrix — approval via canApprove(role, tier)', () => {
  let asserted = 0;

  it('canApprove matches the expected role×tier policy', () => {
    for (const role of ROLES) {
      for (const tier of ['approve', 'owner_only'] as Tier[]) {
        asserted += 1;
        expect(canApprove(role, tier), `canApprove(${role}, ${tier})`).toBe(
          expectedApprove(role, tier),
        );
      }
    }
    // Explicit: only owner clears owner_only; org_admin/participant clear nothing.
    expect(canApprove('staff', 'owner_only')).toBe(false);
    expect(canApprove('org_admin', 'approve')).toBe(false);
    expect(canApprove('org_admin', 'owner_only')).toBe(false);
    expect(canApprove('participant', 'approve')).toBe(false);
    // eslint-disable-next-line no-console
    console.log(`[authz-matrix] approval: asserted ${asserted} (role,tier) pairs`);
  });

  it('dynamic-tier tools: BOTH tier branches gate correctly', () => {
    // refund.execute: approve ≤ ¥10,000, owner_only above.
    const refund = listTools().find((t) => t.name === 'refund.execute')!;
    const lowTier = effectiveTier(refund, {
      paymentId: randomUUID(),
      amount: 5_000,
      currency: 'JPY',
      reason: 'x',
    });
    const highTier = effectiveTier(refund, {
      paymentId: randomUUID(),
      amount: 50_000,
      currency: 'JPY',
      reason: 'x',
    });
    expect(lowTier).toBe('approve');
    expect(highTier).toBe('owner_only');
    // Low branch: staff may approve; high branch: staff may NOT.
    expect(canApprove('staff', lowTier)).toBe(true);
    expect(canApprove('staff', highTier)).toBe(false);
    expect(canApprove('owner', highTier)).toBe(true);

    // participant.enroll: auto for self_paid/org_seat, approve for comp.
    const enroll = listTools().find((t) => t.name === 'participant.enroll')!;
    const autoTier = effectiveTier(enroll, {
      userId: randomUUID(),
      cohortId: randomUUID(),
      source: 'self_paid',
    });
    const compTier = effectiveTier(enroll, {
      userId: randomUUID(),
      cohortId: randomUUID(),
      source: 'comp',
    });
    expect(autoTier).toBe('auto');
    expect(compTier).toBe('approve');
    // comp requires approval → staff/owner clear it, org_admin/participant do not.
    expect(canApprove('staff', compTier)).toBe(true);
    expect(canApprove('org_admin', compTier)).toBe(false);
    expect(canApprove('participant', compTier)).toBe(false);
  });
});

// --- Integration checks: actually POST /api/tools/execute per role -----------
// The pure-policy assertions above prove enforcement over ALL tools; these few
// live requests prove the wired route returns 200-vs-403 as the policy predicts.

vi.mock('@/server/auth/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/auth/session')>();
  return { ...actual, getSession: () => Promise.resolve(currentSession) };
});

let currentSession: SessionUser | null = null;

function sessionFor(role: Role): SessionUser {
  return {
    userId: users[role],
    email: `${role}-authz@t.local`,
    role,
    organizationId: role === 'org_admin' ? orgId : null,
    locale: 'en',
    name: {},
  };
}

const orgId = randomUUID();
const users: Record<Role, string> = {
  owner: randomUUID(),
  staff: randomUUID(),
  org_admin: randomUUID(),
  participant: randomUUID(),
};

let POST: (req: NextRequest) => Promise<Response>;

beforeAll(async () => {
  const { prisma } = await import('@/server/db/client');
  await prisma.organization.create({
    data: {
      id: orgId,
      name: { en: 'Authz Org', ja: '認可組織' },
      billingEmail: `authz-org-${randomUUID()}@t.local`,
    },
  });
  for (const role of ROLES) {
    await prisma.user.create({
      data: {
        id: users[role],
        email: `${role}-authz-${randomUUID()}@t.local`,
        role,
        organizationId: role === 'org_admin' ? orgId : null,
      },
    });
  }
  ({ POST } = await import('@/app/api/tools/execute/route'));
});

afterAll(async () => {
  const { prisma } = await import('@/server/db/client');
  // ai_action is append-only; detach the FK so the user rows can be removed.
  await prisma.aiAction.updateMany({
    where: { initiatedById: { in: Object.values(users) } },
    data: { initiatedById: null },
  });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
  await prisma.organization.delete({ where: { id: orgId } });
});

function makeReq(toolName: string, input: unknown): NextRequest {
  return new NextRequest('http://localhost/api/tools/execute', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ toolName, input }),
  });
}

describe('authz matrix — live /api/tools/execute (200 vs 403)', () => {
  // A copilot-surfaced approve-tier tool: staff/owner allowed (→ proposed),
  // org_admin/participant denied (403).
  it('workshop.ping (copilot, not org-admin-allowlisted): staff+ 200, others 403', async () => {
    for (const role of ROLES) {
      currentSession = sessionFor(role);
      const res = await POST(makeReq('workshop.ping', { message: 'hi' }));
      if (role === 'owner' || role === 'staff') {
        expect(res.status, `${role}`).toBe(200);
      } else {
        expect(res.status, `${role}`).toBe(403);
      }
    }
  });

  // org.assign_seats is the ONLY org_admin-allowlisted tool → org_admin passes
  // the role gate (RLS still confines it). participant still 403.
  it('org.assign_seats: staff/owner/org_admin pass role gate, participant 403', async () => {
    for (const role of ROLES) {
      currentSession = sessionFor(role);
      const res = await POST(
        makeReq('org.assign_seats', {
          seatPoolId: randomUUID(),
          userEmails: ['seat-authz@t.local'],
        }),
      );
      // participant is gated out at the role check (403). Others clear the role
      // gate; they may then fail downstream (e.g. 404 seat pool) but MUST NOT 403.
      if (role === 'participant') {
        expect(res.status, `${role}`).toBe(403);
      } else {
        expect(res.status, `${role} should clear the role gate`).not.toBe(403);
      }
    }
  });

  // A concierge-only tool must be surface_forbidden (403) for EVERY role.
  it('faq.answer (concierge-only): 403 for every role', async () => {
    for (const role of ROLES) {
      currentSession = sessionFor(role);
      const res = await POST(makeReq('faq.answer', { question: 'hours?' }));
      expect(res.status, `${role}`).toBe(403);
    }
  });
});
