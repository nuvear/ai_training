import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/server/db/client';
import { getTool } from '@/server/ai/registry';
import { effectiveTier, proposeAndAutoExecute } from '@/server/ai/ledger';
import type { SessionUser } from '@/server/auth/session';

// participant.enroll seat consumption + dynamic tier (COPILOT_TOOLS §5).
//   - org_seat enrollment increments seats_used
//   - enrolling beyond seats_total throws (seat pool exhausted)
//   - source:'comp' → approve tier; self_paid/org_seat → auto (via effectiveTier)

const owner: SessionUser = {
  userId: randomUUID(),
  email: `sc-owner-${randomUUID()}@t.local`,
  role: 'owner',
  organizationId: null,
  locale: 'en',
  name: {},
};

const orgId = randomUUID();
const workshopId = randomUUID();
const cohortId = randomUUID();
const cohort2Id = randomUUID();
const orderId = randomUUID();
const seatPoolId = randomUUID();
const emp1 = randomUUID();
const emp2 = randomUUID();
const emp3 = randomUUID();

beforeAll(async () => {
  await prisma.user.create({ data: { id: owner.userId, email: owner.email, role: 'owner' } });
  await prisma.organization.create({
    data: {
      id: orgId,
      name: { en: 'Seatco', ja: 'シートコ' },
      billingEmail: `sc-${randomUUID()}@t.local`,
    },
  });
  await prisma.user.createMany({
    data: [emp1, emp2, emp3].map((id, i) => ({
      id,
      email: `sc-emp${i}-${id}@t.local`,
      role: 'participant' as const,
      organizationId: orgId,
    })),
  });
  await prisma.workshop.create({
    data: {
      id: workshopId,
      slug: `sc-${workshopId}`,
      title: { en: 'W', ja: 'ダブリュー' },
      summary: { en: 'S', ja: 'エス' },
    },
  });
  await prisma.cohort.createMany({
    data: [cohortId, cohort2Id].map((id) => ({
      id,
      workshopId,
      startsAt: new Date(Date.now() + 7 * 864e5),
      endsAt: new Date(Date.now() + 8 * 864e5),
      capacity: 20,
      priceJpy: 40_000,
    })),
  });
  // A funded 2-seat pool (order + active pool).
  await prisma.order.create({
    data: {
      id: orderId,
      buyerUserId: owner.userId,
      organizationId: orgId,
      kind: 'seat_pool',
      status: 'paid',
      currency: 'JPY',
      subtotal: 80_000,
      discount: 0,
      tax: 8_000,
      total: 88_000,
    },
  });
  await prisma.seatPool.create({
    data: {
      id: seatPoolId,
      organizationId: orgId,
      orderId,
      seatsTotal: 2,
      seatsUsed: 0,
      validUntil: new Date(Date.now() + 365 * 864e5),
      status: 'active',
    },
  });
});

afterAll(async () => {
  await prisma.enrollment.deleteMany({ where: { cohortId: { in: [cohortId, cohort2Id] } } });
  await prisma.seatPool.deleteMany({ where: { id: seatPoolId } });
  await prisma.order.deleteMany({ where: { id: orderId } });
  await prisma.cohort.deleteMany({ where: { id: { in: [cohortId, cohort2Id] } } });
  await prisma.workshop.deleteMany({ where: { id: workshopId } });
  await prisma.user.deleteMany({ where: { id: { in: [emp1, emp2, emp3, owner.userId] } } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
});

describe('participant.enroll dynamic tier', () => {
  const def = getTool('participant.enroll');

  it('self_paid and org_seat resolve to auto; comp resolves to approve', () => {
    expect(effectiveTier(def, { userId: emp1, cohortId, source: 'self_paid' })).toBe('auto');
    expect(effectiveTier(def, { userId: emp1, cohortId, source: 'org_seat', seatPoolId })).toBe(
      'auto',
    );
    expect(effectiveTier(def, { userId: emp1, cohortId, source: 'comp' })).toBe('approve');
  });
});

describe('participant.enroll org_seat seat consumption', () => {
  it('increments seats_used and links the enrollment to the pool', async () => {
    const action = await proposeAndAutoExecute(owner, {
      surface: 'copilot',
      toolName: 'participant.enroll',
      input: { userId: emp1, cohortId, source: 'org_seat', seatPoolId },
    });
    expect(action.status).toBe('executed');

    const pool = await prisma.seatPool.findUnique({ where: { id: seatPoolId } });
    expect(pool?.seatsUsed).toBe(1);

    const output = action.output as { seatPoolId: string | null; seatsUsed: number | null };
    expect(output.seatPoolId).toBe(seatPoolId);
    expect(output.seatsUsed).toBe(1);
  });

  it('consumes the second seat, then throws when the pool is exhausted', async () => {
    const second = await proposeAndAutoExecute(owner, {
      surface: 'copilot',
      toolName: 'participant.enroll',
      input: { userId: emp2, cohortId, source: 'org_seat', seatPoolId },
    });
    expect(second.status).toBe('executed');
    const pool = await prisma.seatPool.findUnique({ where: { id: seatPoolId } });
    expect(pool?.seatsUsed).toBe(2); // == seats_total, now full

    // Third enrollment must fail: no seats remaining. The tool records `failed`.
    const third = await proposeAndAutoExecute(owner, {
      surface: 'copilot',
      toolName: 'participant.enroll',
      input: { userId: emp3, cohortId, source: 'org_seat', seatPoolId },
    });
    expect(third.status).toBe('failed');
    expect((third.output as { error?: string }).error).toMatch(/exhausted/i);

    // seats_used did NOT go past the total.
    const after = await prisma.seatPool.findUnique({ where: { id: seatPoolId } });
    expect(after?.seatsUsed).toBe(2);
    // No enrollment was created for the exhausted attempt.
    const emp3Enrollment = await prisma.enrollment.findUnique({
      where: { userId_cohortId: { userId: emp3, cohortId } },
    });
    expect(emp3Enrollment).toBeNull();
  });

  it('self_paid enrollment does not touch the seat pool', async () => {
    await proposeAndAutoExecute(owner, {
      surface: 'copilot',
      toolName: 'participant.enroll',
      input: { userId: emp3, cohortId: cohort2Id, source: 'self_paid' },
    });
    const enrollment = await prisma.enrollment.findUnique({
      where: { userId_cohortId: { userId: emp3, cohortId: cohort2Id } },
    });
    expect(enrollment?.seatPoolId).toBeNull();
    expect(enrollment?.source).toBe('self_paid');
  });
});
