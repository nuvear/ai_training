import { prisma } from '@/server/db/client';
import type { Prisma, AiTier, AiActionStatus } from '@/generated/prisma';

/** Optional scoping — production passes nothing (whole ledger). Tests scope to
 * their own seeded rows so a shared DB does not skew the rates. */
export interface MetricsScope {
  where?: Prisma.AiActionWhereInput;
}

/**
 * AI-layer metrics (M6 §4), computed from the `ai_action` ledger — the single
 * source of truth for everything the copilot/concierge has proposed, approved,
 * rejected, or executed.
 *
 * Metric definitions (also recorded in docs/DECISIONS.md):
 *  - approvalRate:   of the actions that REQUIRED human approval (tier
 *                    approve|owner_only) and reached a terminal human decision
 *                    (approved | executed | rejected), the share that were
 *                    approved or executed. Answers "when we ask, how often does
 *                    a human say yes?".
 *  - overrideRate:   of those same human-decided actions, the share REJECTED.
 *                    overrideRate == 1 − approvalRate; surfaced explicitly
 *                    because it is the trust-erosion signal we watch.
 *  - autoShare:      of all EXECUTED actions, the share whose tier was `auto`
 *                    (ran without a human in the loop). Measures autonomy.
 *  - latency:        over EXECUTED rows, (updatedAt − createdAt) in ms — the
 *                    time from ledger write to completion. avg + p50.
 *
 * `tx` is optional so callers inside a transaction (e.g. tests seeding rows)
 * read a consistent snapshot; otherwise the base client is used.
 */

type Db = Pick<typeof prisma, 'aiAction'> | Prisma.TransactionClient;

const TIERS: AiTier[] = ['auto', 'approve', 'owner_only'];
const STATUSES: AiActionStatus[] = [
  'proposed',
  'approved',
  'executed',
  'rejected',
  'rolled_back',
  'failed',
];

export interface AiLayerMetrics {
  totalActions: number;
  byTier: Record<AiTier, number>;
  byStatus: Record<AiActionStatus, number>;
  /** approved∪executed / human-decided, among approval-needed actions. */
  approvalRate: number;
  /** rejected / human-decided, among approval-needed actions. */
  overrideRate: number;
  /** auto-tier executed / all executed. */
  autoShare: number;
  /** Decisions counted (denominator for approval/override rates). */
  humanDecidedCount: number;
  latency: {
    executedCount: number;
    avgMs: number;
    p50Ms: number;
  };
}

function zero<T extends string>(keys: T[]): Record<T, number> {
  return Object.fromEntries(keys.map((k) => [k, 0])) as Record<T, number>;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx] ?? 0;
}

export async function getAiLayerMetrics(tx?: Db, scope?: MetricsScope): Promise<AiLayerMetrics> {
  const db = tx ?? prisma;

  const rows = await db.aiAction.findMany({
    where: scope?.where,
    select: { tier: true, status: true, createdAt: true, updatedAt: true },
  });

  const byTier = zero(TIERS);
  const byStatus = zero(STATUSES);

  let approvedOrExecuted = 0; // approval-needed AND (approved|executed)
  let rejected = 0; // approval-needed AND rejected
  let executedAuto = 0;
  let executedTotal = 0;
  const latencies: number[] = [];

  for (const r of rows) {
    byTier[r.tier] += 1;
    byStatus[r.status] += 1;

    const needsApproval = r.tier === 'approve' || r.tier === 'owner_only';
    if (needsApproval) {
      if (r.status === 'approved' || r.status === 'executed') approvedOrExecuted += 1;
      else if (r.status === 'rejected') rejected += 1;
    }

    if (r.status === 'executed') {
      executedTotal += 1;
      if (r.tier === 'auto') executedAuto += 1;
      latencies.push(Math.max(0, r.updatedAt.getTime() - r.createdAt.getTime()));
    }
  }

  const humanDecidedCount = approvedOrExecuted + rejected;
  const approvalRate = humanDecidedCount === 0 ? 0 : approvedOrExecuted / humanDecidedCount;
  const overrideRate = humanDecidedCount === 0 ? 0 : rejected / humanDecidedCount;
  const autoShare = executedTotal === 0 ? 0 : executedAuto / executedTotal;

  latencies.sort((a, b) => a - b);
  const avgMs =
    latencies.length === 0 ? 0 : latencies.reduce((s, v) => s + v, 0) / latencies.length;

  return {
    totalActions: rows.length,
    byTier,
    byStatus,
    approvalRate,
    overrideRate,
    autoShare,
    humanDecidedCount,
    latency: {
      executedCount: latencies.length,
      avgMs,
      p50Ms: percentile(latencies, 50),
    },
  };
}
