import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/server/db/client';
import {
  promoteWaitlist,
  expireWaitlistOffers,
  CONFIRM_WINDOW_MS,
} from '@/server/ai/tools/waitlist';
import type { Prisma } from '@/generated/prisma';

const tx = prisma as unknown as Prisma.TransactionClient;

const workshopId = randomUUID();
const cohortId = randomUUID();
const userA = randomUUID();
const userB = randomUUID();

beforeAll(async () => {
  await prisma.workshop.create({
    data: { id: workshopId, slug: `wl-${workshopId}`, title: { en: 'WL' }, summary: { en: 'WL' } },
  });
  await prisma.cohort.create({
    data: {
      id: cohortId,
      workshopId,
      startsAt: new Date('2026-10-01T00:00:00Z'),
      endsAt: new Date('2026-10-03T00:00:00Z'),
      capacity: 2,
    },
  });
  await prisma.user.createMany({
    data: [
      { id: userA, email: `wl-a-${userA}@t.local`, role: 'participant' },
      { id: userB, email: `wl-b-${userB}@t.local`, role: 'participant' },
    ],
  });
  await prisma.waitlistEntry.createMany({
    data: [
      { cohortId, userId: userA, position: 1, aiAttendScore: null },
      { cohortId, userId: userB, position: 2, aiAttendScore: '0.9' },
    ],
  });
});

afterAll(async () => {
  vi.useRealTimers();
  await prisma.waitlistEntry.deleteMany({ where: { cohortId } });
  await prisma.cohort.deleteMany({ where: { id: cohortId } });
  await prisma.workshop.deleteMany({ where: { id: workshopId } });
  await prisma.user.deleteMany({ where: { id: { in: [userA, userB] } } });
});

describe('waitlist promotion honors the 24h confirm window', () => {
  it('offers seats with a 24h expiry and expires them only after the window', async () => {
    vi.useFakeTimers();
    const t0 = new Date('2026-08-01T00:00:00Z');
    vi.setSystemTime(t0);

    const promoted = await promoteWaitlist(tx, cohortId);
    expect(promoted.length).toBe(2);
    // higher AI score is offered first (FIFO fallback for ties)
    expect(promoted[0]!.userId).toBe(userB);

    const offered = await prisma.waitlistEntry.findMany({ where: { cohortId } });
    expect(offered.every((e) => e.status === 'offered')).toBe(true);
    for (const e of offered) {
      expect(e.expiresAt?.getTime()).toBe(t0.getTime() + CONFIRM_WINDOW_MS);
    }

    // 23h later: still within the window → nothing expires
    vi.setSystemTime(new Date(t0.getTime() + 23 * 60 * 60 * 1000));
    expect(await expireWaitlistOffers(tx, cohortId)).toBe(0);
    expect(
      (await prisma.waitlistEntry.findMany({ where: { cohortId, status: 'offered' } })).length,
    ).toBe(2);

    // just past 24h → the offers expire
    vi.setSystemTime(new Date(t0.getTime() + CONFIRM_WINDOW_MS + 60_000));
    expect(await expireWaitlistOffers(tx, cohortId)).toBe(2);
    expect(
      (await prisma.waitlistEntry.findMany({ where: { cohortId, status: 'expired' } })).length,
    ).toBe(2);
  });
});
