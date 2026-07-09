import 'server-only';
import type { Prisma } from '@/generated/prisma';
import { withOrgContext } from '@/server/db/rls';

// ─────────────────────────────────────────────────────────────────────────────
// Org-progress read — THE privacy boundary (PRODUCT_SPEC §2).
//
// Org admins may see their employees' attendance / completion / quiz AGGREGATES,
// but NEVER free-text reflections (`Feedback.textBody`). That boundary is
// COLUMN-level, which RLS cannot express, so — exactly as the feedback migration
// records — it is enforced HERE in the query layer: this module is the single
// sanctioned way to compute org KPIs + per-employee progress, and it never
// SELECTs `text_body`. Callers pass a `tx` already inside the caller's tenant RLS
// context (via withOrgContext); RLS still scopes the org's users/enrollments/
// seat pools, and this layer adds the column gate on top.
//
// Attendance % and quiz scores live in M4 tables that do not exist yet, so they
// are returned as explicit `null` / "pending" placeholders — never fabricated.
// ─────────────────────────────────────────────────────────────────────────────

export interface EmployeeProgress {
  userId: string;
  name: { display?: string; family?: string; given?: string };
  email: string;
  enrolledWorkshops: string[];
  /** 'active' | 'completed' | 'dropped' | 'refunded' per enrollment */
  statuses: string[];
  completions: number;
  // M4: attendance % and quiz aggregate scores land with the participant layer.
  attendancePct: null; // M4
  quizAverage: null; // M4
}

export interface OrgProgress {
  organizationId: string;
  seatsUsed: number;
  seatsTotal: number;
  completions: number;
  /** aggregate mean of Feedback.ratings.overall for the org's cohorts; null when
   * there is no rated feedback yet. A NUMBER — never any free text. */
  avgRating: number | null;
  employees: EmployeeProgress[];
}

/**
 * Compute an organization's progress dashboard. The `tx` MUST already be inside
 * the org's tenant context (withOrgContext) so RLS scopes org-owned rows.
 *
 * Privacy gate: the Feedback query selects ONLY `ratings` (and `cohortId` to
 * scope). `textBody` is never in any select, so it cannot reach an org-admin view.
 */
export async function getOrgProgress(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<OrgProgress> {
  // Active seat pool for the KPIs. An org may have several historically; take the
  // active one (falling back to the most recent) for the headline seat numbers.
  const seatPools = await tx.seatPool.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
  });
  const activePool = seatPools.find((p) => p.status === 'active') ?? seatPools[0] ?? null;
  const seatsUsed = activePool?.seatsUsed ?? 0;
  const seatsTotal = activePool?.seatsTotal ?? 0;

  // The org's participant users (RLS confines this to the caller's org).
  const employees = await tx.user.findMany({
    where: { organizationId, role: 'participant' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, email: true },
  });
  const employeeIds = employees.map((e) => e.id);

  // Their enrollments + the workshop title behind each cohort. No feedback here.
  const enrollments = employeeIds.length
    ? await tx.enrollment.findMany({
        where: { userId: { in: employeeIds } },
        select: {
          userId: true,
          status: true,
          cohort: { select: { id: true, workshop: { select: { title: true } } } },
        },
      })
    : [];

  const byUser = new Map<string, EmployeeProgress>();
  for (const e of employees) {
    byUser.set(e.id, {
      userId: e.id,
      name: (e.name as EmployeeProgress['name']) ?? {},
      email: e.email,
      enrolledWorkshops: [],
      statuses: [],
      completions: 0,
      attendancePct: null, // M4
      quizAverage: null, // M4
    });
  }

  const cohortIds = new Set<string>();
  for (const en of enrollments) {
    cohortIds.add(en.cohort.id);
    const row = byUser.get(en.userId);
    if (!row) continue;
    const title = en.cohort.workshop.title as { en?: string; ja?: string } | null;
    row.enrolledWorkshops.push(title?.en ?? title?.ja ?? en.cohort.id);
    row.statuses.push(en.status);
    if (en.status === 'completed') row.completions += 1;
  }

  const employeeProgress = [...byUser.values()];
  const completions = employeeProgress.reduce((sum, e) => sum + e.completions, 0);

  // Aggregate rating over the org's cohorts. SELECT `ratings` ONLY — textBody is
  // deliberately absent from this projection (the column-level privacy gate).
  let avgRating: number | null = null;
  if (cohortIds.size > 0) {
    const feedback = await tx.feedback.findMany({
      where: { cohortId: { in: [...cohortIds] } },
      select: { ratings: true },
    });
    const overalls: number[] = [];
    for (const f of feedback) {
      const r = f.ratings as Record<string, unknown> | null;
      const overall = r && typeof r.overall === 'number' ? r.overall : null;
      if (overall !== null) overalls.push(overall);
    }
    if (overalls.length > 0) {
      avgRating = Math.round((overalls.reduce((a, b) => a + b, 0) / overalls.length) * 100) / 100;
    }
  }

  return {
    organizationId,
    seatsUsed,
    seatsTotal,
    completions,
    avgRating,
    employees: employeeProgress,
  };
}

/**
 * The sanctioned entry point for reading an org's progress dashboard. Access is
 * gated at the route by requireOrgAccess (org_admin of this org, or owner/staff).
 *
 * This runs the org-scoped aggregate under an OWNER-level tenant context: the
 * enrollment RLS policy keys on the enrollee's own user id, so an org_admin
 * context cannot see its own employees' enrollments — yet an org admin is
 * explicitly permitted to see aggregate completion/attendance/quiz for their org
 * (PRODUCT_SPEC §2). Like `fulfillment`, this cross-boundary aggregate therefore
 * runs elevated but is SELF-SCOPED: every query inside getOrgProgress filters by
 * the `organizationId` argument (and by employee ids derived from it), so it can
 * never read another org's rows. The privacy gate (never selecting textBody) and
 * the explicit org scoping are the two data guards; the route guard is the access
 * guard. Recorded in docs/DECISIONS.md.
 */
export async function readOrgProgress(organizationId: string): Promise<OrgProgress> {
  return withOrgContext(
    { userId: ORG_PROGRESS_READER, role: 'owner', organizationId: null },
    (tx) => getOrgProgress(tx, organizationId),
  );
}

// A stable, non-persisted actor id for the elevated read context. It never writes
// anything (getOrgProgress is read-only), so it needs no User row.
const ORG_PROGRESS_READER = '00000000-0000-0000-0000-000000000000';
