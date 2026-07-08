import 'server-only';
import { randomBytes } from 'node:crypto';
import type { Prisma } from '@/generated/prisma';
import { withOrgContext } from '@/server/db/rls';

// ─────────────────────────────────────────────────────────────────────────────
// Completion rule (PRODUCT_SPEC §5, COPILOT_TOOLS §5).
//
// completion = attendance% ≥ workshop.completionRule.attendance_pct (default 80)
//   AND a quiz attempt passed (best attempt ≥ the published quiz's passPct, which
//   defaults from workshop.completionRule.quiz_pass_pct, default 70).
//
// attendance% = present sessions / total cohort sessions. On the FIRST time both
// gates are satisfied we set enrollment.completedAt + status 'completed', write a
// ProgressEvent(completed), and auto-issue the certificate (idempotent — one per
// enrollment via the unique constraint).
//
// Certificate issuance + completion cross the enrollment/cohort/session boundary,
// so like fulfillment.ts the participant-driven entry point runs under an
// OWNER-level context but is SELF-SCOPED by enrollmentId. Staff-driven callers
// (attendance.record on the copilot surface) already have full visibility and
// pass their own tx.
// ─────────────────────────────────────────────────────────────────────────────

export interface CompletionRule {
  attendance_pct: number;
  quiz_pass_pct: number;
}

const DEFAULT_RULE: CompletionRule = { attendance_pct: 80, quiz_pass_pct: 70 };

/** Read a workshop's completion overrides, falling back to the 80/70 defaults.
 * The stored JSON is untrusted config → each field is validated as a finite
 * number in [0,100] before use, else the default. */
export function resolveCompletionRule(raw: unknown): CompletionRule {
  const r = (raw ?? {}) as Record<string, unknown>;
  const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100 ? v : fallback;
  return {
    attendance_pct: num(r.attendance_pct, DEFAULT_RULE.attendance_pct),
    quiz_pass_pct: num(r.quiz_pass_pct, DEFAULT_RULE.quiz_pass_pct),
  };
}

export interface CompletionStatus {
  totalSessions: number;
  presentSessions: number;
  attendancePct: number;
  attendanceMet: boolean;
  quizPassed: boolean;
  bestScorePct: number | null;
  completed: boolean;
  /** true only on the transition that first satisfied the rule this call. */
  justCompleted: boolean;
  certificateId: string | null;
}

/** URL-safe random verify code (base64url, no padding). */
export function generateVerifyCode(): string {
  return randomBytes(18).toString('base64url');
}

/**
 * Evaluate + persist completion for one enrollment inside the caller's `tx`.
 * Idempotent: re-running after completion returns the same state and never
 * re-issues or re-fires the completed event. Returns a snapshot of the gates.
 *
 * The `tx` must be able to read the enrollment, its cohort's sessions, this
 * enrollment's attendance/quiz attempts, and write the enrollment/progress_event/
 * certificate rows (owner/staff context, or the participant's own via RLS +
 * elevated self-scoping in `evaluateCompletionElevated`).
 */
export async function evaluateCompletion(
  tx: Prisma.TransactionClient,
  enrollmentId: string,
): Promise<CompletionStatus> {
  const enrollment = await tx.enrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      cohort: { include: { workshop: true, sessions: { select: { id: true } } } },
      attendance: true,
      quizAttempts: { select: { scorePct: true, passed: true } },
      certificate: { select: { id: true } },
    },
  });

  if (!enrollment) {
    return emptyStatus();
  }

  const rule = resolveCompletionRule(enrollment.cohort.workshop.completionRule);

  const totalSessions = enrollment.cohort.sessions.length;
  const presentSessions = enrollment.attendance.filter((a) => a.status === 'present').length;
  // No sessions defined ⇒ attendance gate cannot be met (avoid 0/0 = "complete").
  const attendancePct = totalSessions === 0 ? 0 : (presentSessions / totalSessions) * 100;
  const attendanceMet = totalSessions > 0 && attendancePct >= rule.attendance_pct;

  const passingAttempts = enrollment.quizAttempts.filter((a) => a.passed);
  const quizPassed = passingAttempts.length > 0;
  const bestScorePct =
    enrollment.quizAttempts.length === 0
      ? null
      : Math.max(...enrollment.quizAttempts.map((a) => a.scorePct));

  const alreadyCompleted = enrollment.completedAt !== null;
  const ruleSatisfied = attendanceMet && quizPassed;

  let certificateId = enrollment.certificate?.id ?? null;
  let justCompleted = false;

  if (ruleSatisfied && !alreadyCompleted) {
    justCompleted = true;
    await tx.enrollment.update({
      where: { id: enrollment.id },
      data: { status: 'completed', completedAt: new Date() },
    });
    await tx.progressEvent.create({
      data: {
        enrollmentId: enrollment.id,
        kind: 'completed',
        payload: { attendancePct: Math.round(attendancePct), bestScorePct },
      },
    });
    certificateId = await ensureCertificate(tx, enrollment.id);
  }

  return {
    totalSessions,
    presentSessions,
    attendancePct: Math.round(attendancePct),
    attendanceMet,
    quizPassed,
    bestScorePct,
    completed: ruleSatisfied || alreadyCompleted,
    justCompleted,
    certificateId,
  };
}

/**
 * Issue the certificate for an enrollment if one does not already exist.
 * Idempotent via the `enrollment_id` unique constraint — a concurrent double
 * issue collapses to the existing row. Returns the certificate id.
 */
export async function ensureCertificate(
  tx: Prisma.TransactionClient,
  enrollmentId: string,
): Promise<string> {
  const existing = await tx.certificate.findUnique({
    where: { enrollmentId },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await tx.certificate.create({
    data: { enrollmentId, verifyCode: generateVerifyCode() },
    select: { id: true },
  });
  return created.id;
}

/**
 * Participant-driven completion re-evaluation. Runs under an OWNER-level context
 * (so cohort sessions + certificate writes are visible) but is SELF-SCOPED to the
 * single enrollmentId — no other enrollment's data is touched. Mirrors the
 * elevated-but-scoped pattern in fulfillment.ts / org-report.ts.
 */
export async function evaluateCompletionElevated(enrollmentId: string): Promise<CompletionStatus> {
  return withOrgContext(
    { userId: '00000000-0000-0000-0000-000000000000', role: 'owner', organizationId: null },
    (tx) => evaluateCompletion(tx, enrollmentId),
  );
}

function emptyStatus(): CompletionStatus {
  return {
    totalSessions: 0,
    presentSessions: 0,
    attendancePct: 0,
    attendanceMet: false,
    quizPassed: false,
    bestScorePct: null,
    completed: false,
    justCompleted: false,
    certificateId: null,
  };
}
