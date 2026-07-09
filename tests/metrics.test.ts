import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/server/db/client';
import { getAiLayerMetrics } from '@/server/observability/metrics';
import type { Prisma } from '@/generated/prisma';

// Seed a KNOWN set of ai_action rows tagged with a unique initiator, then scope
// the metrics computation to that initiator so the shared (append-only) ledger's
// pre-existing rows do not skew the rates. Rows persist (ai_action is append-only
// by DB trigger) but are namespaced to this test's initiator.
//
// Population (7 rows):
//   auto      / executed   → auto execution (autoShare numerator)
//   auto      / executed   → auto execution
//   approve   / executed   → approval-needed, human said yes
//   approve   / approved   → approval-needed, human said yes
//   approve   / rejected   → approval-needed, human said no  (override)
//   owner_only/ rejected   → approval-needed, human said no  (override)
//   approve   / proposed   → approval-needed, NOT yet decided (excluded)
//
// approval-needed & human-decided = 4 (2 yes + 2 no)
//   approvalRate = 2/4 = 0.5 ; overrideRate = 2/4 = 0.5
// executed total = 3 ; auto executed = 2 → autoShare = 2/3

type Seed = {
  tier: Prisma.AiActionCreateManyInput['tier'];
  status: Prisma.AiActionCreateManyInput['status'];
};

const seeds: Seed[] = [
  { tier: 'auto', status: 'executed' },
  { tier: 'auto', status: 'executed' },
  { tier: 'approve', status: 'executed' },
  { tier: 'approve', status: 'approved' },
  { tier: 'approve', status: 'rejected' },
  { tier: 'owner_only', status: 'rejected' },
  { tier: 'approve', status: 'proposed' },
];

const initiatorId = randomUUID();

beforeAll(async () => {
  await prisma.user.create({
    data: { id: initiatorId, email: `metrics-${randomUUID()}@t.local`, role: 'owner' },
  });
  await prisma.aiAction.createMany({
    data: seeds.map((s) => ({
      surface: 'copilot' as const,
      toolName: 'workshop.ping',
      tier: s.tier,
      status: s.status,
      input: {},
      initiatedById: initiatorId,
    })),
  });
});

afterAll(async () => {
  // ai_action is append-only; only the user row is removable. Detach the ledger
  // rows' FK first so the user delete succeeds, leaving the (scoped) rows inert.
  await prisma.aiAction.updateMany({
    where: { initiatedById: initiatorId },
    data: { initiatedById: null },
  });
  await prisma.user.delete({ where: { id: initiatorId } });
});

describe('AI-layer metrics (M6 §4)', () => {
  it('computes approval, override, auto share, and counts over the seeded set', async () => {
    const m = await getAiLayerMetrics(undefined, { where: { initiatedById: initiatorId } });

    expect(m.totalActions).toBe(7);
    expect(m.byTier).toEqual({ auto: 2, approve: 4, owner_only: 1 });
    expect(m.byStatus.executed).toBe(3);
    expect(m.byStatus.approved).toBe(1);
    expect(m.byStatus.rejected).toBe(2);
    expect(m.byStatus.proposed).toBe(1);

    expect(m.humanDecidedCount).toBe(4);
    expect(m.approvalRate).toBeCloseTo(0.5, 10);
    expect(m.overrideRate).toBeCloseTo(0.5, 10);
    expect(m.approvalRate + m.overrideRate).toBeCloseTo(1, 10);

    expect(m.latency.executedCount).toBe(3);
    expect(m.autoShare).toBeCloseTo(2 / 3, 10);
    expect(m.latency.avgMs).toBeGreaterThanOrEqual(0);
    expect(m.latency.p50Ms).toBeGreaterThanOrEqual(0);
  });

  it('returns zeros for an empty (no-match) population', async () => {
    const m = await getAiLayerMetrics(undefined, { where: { initiatedById: randomUUID() } });
    expect(m.totalActions).toBe(0);
    expect(m.approvalRate).toBe(0);
    expect(m.overrideRate).toBe(0);
    expect(m.autoShare).toBe(0);
    expect(m.humanDecidedCount).toBe(0);
    expect(m.latency.executedCount).toBe(0);
  });
});
