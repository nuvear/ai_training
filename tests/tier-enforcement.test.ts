import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/server/db/client';
import {
  proposeAction,
  approveAndExecute,
  proposeAndAutoExecute,
  canApprove,
  LedgerError,
} from '@/server/ai/ledger';
import { toolTier, assertSurfaceAllowed, ToolError } from '@/server/ai/registry';
import type { SessionUser } from '@/server/auth/session';

const owner: SessionUser = {
  userId: randomUUID(),
  email: `owner-${randomUUID()}@t.local`,
  role: 'owner',
  organizationId: null,
  locale: 'en',
  name: {},
};
const participant: SessionUser = {
  userId: randomUUID(),
  email: `part-${randomUUID()}@t.local`,
  role: 'participant',
  organizationId: null,
  locale: 'en',
  name: {},
};

beforeAll(async () => {
  await prisma.user.create({ data: { id: owner.userId, email: owner.email, role: 'owner' } });
  await prisma.user.create({
    data: { id: participant.userId, email: participant.email, role: 'participant' },
  });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [owner.userId, participant.userId] } } });
});

describe('server-side tier enforcement (invariant 2)', () => {
  it('reads the tier from the registry, not from caller input', () => {
    expect(toolTier('workshop.ping')).toBe('approve');
  });

  it('propose writes the ledger row BEFORE execution and does not run it', async () => {
    const action = await proposeAction(owner, {
      surface: 'copilot',
      toolName: 'workshop.ping',
      input: { message: 'ping' },
    });
    expect(action.tier).toBe('approve'); // authoritative, from registry
    expect(action.status).toBe('proposed');
    expect(action.output).toBeNull(); // blocked without approval

    const persisted = await prisma.aiAction.findUnique({ where: { id: action.id } });
    expect(persisted?.status).toBe('proposed');
  });

  it('executes only after approval, and records bilingual output', async () => {
    const action = await proposeAction(owner, {
      surface: 'copilot',
      toolName: 'workshop.ping',
      input: { message: 'hello' },
    });
    const executed = await approveAndExecute(owner, action.id);
    expect(executed.status).toBe('executed');
    expect(executed.approvedById).toBe(owner.userId);
    const output = executed.output as { pong: { en: string; ja: string } };
    expect(output.pong.en).toContain('hello');
    expect(output.pong.ja).toContain('hello');
  });

  it('a participant cannot approve an approve-tier action', async () => {
    expect(canApprove('participant', 'approve')).toBe(false);
    expect(canApprove('owner', 'approve')).toBe(true);
    expect(canApprove('staff', 'approve')).toBe(true);
    expect(canApprove('staff', 'owner_only')).toBe(false);

    const action = await proposeAction(owner, {
      surface: 'copilot',
      toolName: 'workshop.ping',
      input: { message: 'x' },
    });
    await expect(approveAndExecute(participant, action.id)).rejects.toBeInstanceOf(LedgerError);
    const still = await prisma.aiAction.findUnique({ where: { id: action.id } });
    expect(still?.status).toBe('proposed'); // not escalated, not executed
  });

  it('rejects auto-executing a non-auto tool', async () => {
    await expect(
      proposeAndAutoExecute(owner, {
        surface: 'copilot',
        toolName: 'workshop.ping',
        input: {},
      }),
    ).rejects.toBeInstanceOf(LedgerError);
  });

  it('blocks tools not allowed on a surface (concierge subset, invariant 7)', () => {
    expect(() => assertSurfaceAllowed('workshop.ping', 'concierge')).toThrow(ToolError);
    expect(() => assertSurfaceAllowed('workshop.ping', 'copilot')).not.toThrow();
  });

  it('is idempotent when given the same idempotency key', async () => {
    const key = randomUUID();
    const a = await proposeAction(owner, {
      surface: 'copilot',
      toolName: 'workshop.ping',
      input: { message: 'once' },
      idempotencyKey: key,
    });
    const b = await proposeAction(owner, {
      surface: 'copilot',
      toolName: 'workshop.ping',
      input: { message: 'twice' },
      idempotencyKey: key,
    });
    expect(b.id).toBe(a.id);
  });
});
