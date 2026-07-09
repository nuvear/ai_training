import { z } from 'zod';
import type { ToolDefinition, ToolContext } from '../types';
import { NotFoundError } from '@/server/domain/errors';

// Predictive-ops tools (COPILOT_TOOLS §6). Deliberately SIMPLE heuristics over
// existing progress/attendance/order data — no ML, no over-engineering. Scores
// are transparent and explainable so a human can act on them.

// ── predict.no_shows — auto, per-enrollment no-show likelihood ───────────────
const noShowInput = z.object({ cohortId: z.string().uuid() });
type NoShowInput = z.infer<typeof noShowInput>;

interface EnrollmentRisk {
  enrollmentId: string;
  userId: string;
  /** no-show likelihood in [0, 1] */
  score: number;
  /** bucket that drives reminder escalation */
  band: 'low' | 'medium' | 'high';
  reasons: string[];
}

export interface NoShowOutput {
  cohortId: string;
  scored: EnrollmentRisk[];
}

function bandFor(score: number): 'low' | 'medium' | 'high' {
  if (score >= 0.6) return 'high';
  if (score >= 0.3) return 'medium';
  return 'low';
}

async function scoreNoShows(ctx: ToolContext, cohortId: string): Promise<NoShowOutput> {
  const cohort = await ctx.tx.cohort.findUnique({
    where: { id: cohortId },
    include: { sessions: { select: { id: true } } },
  });
  if (!cohort) throw new NotFoundError('Cohort', cohortId);
  const sessionsSoFar = cohort.sessions.length;

  const enrollments = await ctx.tx.enrollment.findMany({
    where: { cohortId, status: 'active' },
    select: {
      id: true,
      userId: true,
      attendance: { select: { status: true } },
      progressEvents: { select: { kind: true } },
    },
  });

  const scored: EnrollmentRisk[] = enrollments.map((e) => {
    const reasons: string[] = [];
    let score = 0.1; // small base rate

    // Signal 1: prior absences (weighted by how many sessions they missed).
    const absences = e.attendance.filter((a) => a.status === 'absent').length;
    if (absences > 0) {
      const missRate = sessionsSoFar > 0 ? absences / sessionsSoFar : 0;
      score += Math.min(0.5, 0.25 * absences + 0.25 * missRate);
      reasons.push(`missed ${absences} prior session${absences > 1 ? 's' : ''}`);
    }

    // Signal 2: no prework_done event (a strong early disengagement signal).
    const preworkDone = e.progressEvents.some((p) => p.kind === 'prework_done');
    if (!preworkDone) {
      score += 0.2;
      reasons.push('no prework_done event');
    }

    // Signal 3: no attendance recorded at all after sessions have run.
    if (sessionsSoFar > 0 && e.attendance.length === 0) {
      score += 0.1;
      reasons.push('no attendance recorded yet');
    }

    score = Math.round(Math.min(1, score) * 1000) / 1000;
    return { enrollmentId: e.id, userId: e.userId, score, band: bandFor(score), reasons };
  });

  // Highest risk first so reminder escalation targets them.
  scored.sort((a, b) => b.score - a.score);
  return { cohortId, scored };
}

export const predictNoShows: ToolDefinition<NoShowInput, NoShowOutput> = {
  name: 'predict.no_shows',
  tier: 'auto',
  surfaces: ['copilot'],
  input: noShowInput,
  summarize: (i) => ({
    en: `Score no-show risk for cohort ${i.cohortId.slice(0, 8)}`,
    ja: `コホート ${i.cohortId.slice(0, 8)} の欠席リスクを算出`,
  }),
  handler: (ctx, i) => scoreNoShows(ctx, i.cohortId),
};

// ── predict.demand — auto, workshop demand signal ────────────────────────────
const demandInput = z.object({ workshopId: z.string().uuid() });
type DemandInput = z.infer<typeof demandInput>;

export interface DemandOutput {
  workshopId: string;
  /** demand score in [0, 1] */
  score: number;
  label: 'cold' | 'warm' | 'hot';
  signals: {
    recentOrders: number;
    recentVisits: number;
    openCohorts: number;
    fillRate: number | null;
  };
  /** suggested promo objective to feed promo.suggest, or null when demand is hot */
  suggestedObjective: 'fill_seats' | 'early_bird' | 'referral' | null;
}

function demandLabel(score: number): 'cold' | 'warm' | 'hot' {
  if (score >= 0.66) return 'hot';
  if (score >= 0.33) return 'warm';
  return 'cold';
}

async function scoreDemand(ctx: ToolContext, workshopId: string): Promise<DemandOutput> {
  const workshop = await ctx.tx.workshop.findUnique({ where: { id: workshopId } });
  if (!workshop) throw new NotFoundError('Workshop', workshopId);

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 30); // last 30 days

  // Recent paid orders for this workshop's cohorts.
  const recentOrders = await ctx.tx.order.count({
    where: {
      status: 'paid',
      createdAt: { gte: since },
      items: { some: { cohort: { workshopId } } },
    },
  });

  // Recent attribution visits to this workshop's landing pages.
  const recentVisits = await ctx.tx.attributionVisit.count({
    where: { at: { gte: since }, landingPage: { workshopId } },
  });

  // Open cohorts + their fill rate (enrollments / capacity).
  const openCohorts = await ctx.tx.cohort.findMany({
    where: { workshopId, status: 'open' },
    select: { capacity: true, _count: { select: { enrollments: true } } },
  });
  const totalCapacity = openCohorts.reduce((s, c) => s + c.capacity, 0);
  const totalEnrolled = openCohorts.reduce((s, c) => s + c._count.enrollments, 0);
  const fillRate =
    totalCapacity > 0 ? Math.round((totalEnrolled / totalCapacity) * 1000) / 1000 : null;

  // Simple bounded signal blend: orders and visits saturate quickly; fill rate
  // contributes directly. Thresholds are transparent, not tuned.
  const ordersSignal = Math.min(1, recentOrders / 10);
  const visitsSignal = Math.min(1, recentVisits / 100);
  const fillSignal = fillRate ?? 0;
  const score =
    Math.round((0.4 * ordersSignal + 0.3 * visitsSignal + 0.3 * fillSignal) * 1000) / 1000;
  const label = demandLabel(score);

  // Feed promo.suggest: cold demand → fill seats; warm/open runway → early bird;
  // hot demand → no discount needed.
  const suggestedObjective =
    label === 'hot' ? null : label === 'warm' ? 'early_bird' : 'fill_seats';

  return {
    workshopId,
    score,
    label,
    signals: { recentOrders, recentVisits, openCohorts: openCohorts.length, fillRate },
    suggestedObjective,
  };
}

export const predictDemand: ToolDefinition<DemandInput, DemandOutput> = {
  name: 'predict.demand',
  tier: 'auto',
  surfaces: ['copilot'],
  input: demandInput,
  summarize: (i) => ({
    en: `Estimate demand for workshop ${i.workshopId.slice(0, 8)}`,
    ja: `ワークショップ ${i.workshopId.slice(0, 8)} の需要を推定`,
  }),
  handler: (ctx, i) => scoreDemand(ctx, i.workshopId),
};
