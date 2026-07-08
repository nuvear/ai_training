import { z } from 'zod';
import type { ToolDefinition, Tier } from '../types';
import { NotFoundError, InvalidStateError } from '@/server/domain/errors';

// participant.enroll (COPILOT_TOOLS §5).
//
// DYNAMIC TIER: `auto` when the source is `self_paid` or `org_seat`; `approve`
// when the source is `comp` (a complimentary seat is a discretionary give-away,
// so it needs staff/owner sign-off). The tier is recomputed server-side from the
// PARSED input via `dynamicTier`, so a caller cannot escalate or de-escalate it —
// the ledger stores it and the approval gate recomputes it identically.

const enrollInput = z.object({
  userId: z.string().uuid(),
  cohortId: z.string().uuid(),
  source: z.enum(['self_paid', 'org_seat', 'comp']),
  /** required in practice for `org_seat`; the seat is consumed from this pool. */
  seatPoolId: z.string().uuid().optional(),
});
type EnrollInput = z.infer<typeof enrollInput>;

export const participantEnroll: ToolDefinition<
  EnrollInput,
  { enrollmentId: string; seatPoolId: string | null; seatsUsed: number | null }
> = {
  name: 'participant.enroll',
  tier: 'auto',
  // `comp` enrollments require approval; seat/paid enrollments run immediately.
  dynamicTier: (i): Tier => (i.source === 'comp' ? 'approve' : 'auto'),
  surfaces: ['copilot'],
  input: enrollInput,
  summarize: (i) => ({
    en: `Enroll user ${i.userId.slice(0, 8)} into cohort ${i.cohortId.slice(0, 8)} (${i.source})`,
    ja: `ユーザー ${i.userId.slice(0, 8)} をコホート ${i.cohortId.slice(0, 8)} に登録（${i.source}）`,
  }),
  handler: async (ctx, i) => {
    const user = await ctx.tx.user.findUnique({ where: { id: i.userId } });
    if (!user) throw new NotFoundError('User', i.userId);
    const cohort = await ctx.tx.cohort.findUnique({ where: { id: i.cohortId } });
    if (!cohort) throw new NotFoundError('Cohort', i.cohortId);

    // Idempotent on the (user, cohort) unique key: a re-run returns the existing
    // enrollment without consuming another seat.
    const existing = await ctx.tx.enrollment.findUnique({
      where: { userId_cohortId: { userId: i.userId, cohortId: i.cohortId } },
    });
    if (existing) {
      return {
        enrollmentId: existing.id,
        seatPoolId: existing.seatPoolId,
        seatsUsed: null,
      };
    }

    if (i.source === 'org_seat') {
      if (!i.seatPoolId) {
        throw new InvalidStateError('org_seat enrollment requires a seatPoolId');
      }
      const pool = await ctx.tx.seatPool.findUnique({ where: { id: i.seatPoolId } });
      if (!pool) throw new NotFoundError('SeatPool', i.seatPoolId);
      if (pool.status !== 'active') {
        throw new InvalidStateError(`Seat pool is ${pool.status}, not active`);
      }

      // Consume one seat atomically: the conditional updateMany
      // (seats_used < seats_total) is the enforcement point, backed by the DB
      // CHECK (seats_used <= seats_total). If the pool is exhausted the update
      // matches 0 rows and we reject — no over-allocation under concurrency.
      const claimed = await ctx.tx.seatPool.updateMany({
        where: { id: pool.id, seatsUsed: { lt: pool.seatsTotal } },
        data: { seatsUsed: { increment: 1 } },
      });
      if (claimed.count === 0) {
        throw new InvalidStateError('Seat pool is exhausted — no seats remaining');
      }

      const enrollment = await ctx.tx.enrollment.create({
        data: {
          userId: i.userId,
          cohortId: i.cohortId,
          source: 'org_seat',
          seatPoolId: pool.id,
          status: 'active',
        },
      });

      const updated = await ctx.tx.seatPool.findUnique({ where: { id: pool.id } });
      return {
        enrollmentId: enrollment.id,
        seatPoolId: pool.id,
        seatsUsed: updated?.seatsUsed ?? null,
      };
    }

    // self_paid / comp: no seat consumption.
    const enrollment = await ctx.tx.enrollment.create({
      data: {
        userId: i.userId,
        cohortId: i.cohortId,
        source: i.source,
        status: 'active',
      },
    });
    return { enrollmentId: enrollment.id, seatPoolId: null, seatsUsed: null };
  },
};
