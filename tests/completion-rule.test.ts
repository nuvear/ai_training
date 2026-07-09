import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/server/db/client';
import { evaluateCompletion, resolveCompletionRule } from '@/server/domain/completion';
import { scoreQuizAttempt } from '@/server/domain/quiz-attempt';

// Completion rule (PRODUCT_SPEC §5): completed iff attendance% ≥ rule.attendance_pct
// AND a quiz attempt passed (≥ passPct). Covers the 80/70 default, a per-workshop
// override (100% attendance), and the not-enough-attendance case. On first
// satisfaction a certificate is auto-issued.
//
// Runs the domain functions with the base prisma client (owner-equivalent, sees
// everything) inside an explicit transaction, mirroring how the elevated
// self-scoped path executes in production.

interface Fixture {
  workshopId: string;
  cohortId: string;
  sessionIds: string[];
  quizId: string;
  questionIds: string[];
  enrollmentId: string;
  userId: string;
}

async function makeFixture(opts: {
  sessions: number;
  completionRule?: object;
  passPct?: number;
}): Promise<Fixture> {
  const workshopId = randomUUID();
  const cohortId = randomUUID();
  const userId = randomUUID();
  const quizId = randomUUID();

  await prisma.workshop.create({
    data: {
      id: workshopId,
      slug: `cr-${workshopId}`,
      title: { en: 'CR Workshop', ja: 'CRワークショップ' },
      summary: { en: 'S', ja: 'エス' },
      completionRule: opts.completionRule ?? { attendance_pct: 80, quiz_pass_pct: 70 },
    },
  });
  await prisma.cohort.create({
    data: {
      id: cohortId,
      workshopId,
      startsAt: new Date('2026-05-01T00:00:00Z'),
      endsAt: new Date('2026-05-03T00:00:00Z'),
      capacity: 10,
      priceJpy: 30_000,
    },
  });
  const sessionIds: string[] = [];
  for (let i = 0; i < opts.sessions; i += 1) {
    const id = randomUUID();
    sessionIds.push(id);
    await prisma.session.create({
      data: {
        id,
        cohortId,
        seq: i + 1,
        startsAt: new Date(`2026-05-0${i + 1}T09:00:00Z`),
        endsAt: new Date(`2026-05-0${i + 1}T12:00:00Z`),
      },
    });
  }

  await prisma.user.create({
    data: {
      id: userId,
      email: `cr-${userId}@t.local`,
      role: 'participant',
      name: { display: 'Kenji Tanaka' },
    },
  });
  const enrollment = await prisma.enrollment.create({
    data: { userId, cohortId, source: 'self_paid', status: 'active' },
  });

  await prisma.quiz.create({
    data: {
      id: quizId,
      workshopId,
      title: { en: 'Q', ja: 'キュー' },
      passPct: opts.passPct ?? 70,
      status: 'published',
    },
  });
  const questionIds: string[] = [];
  for (let i = 0; i < 2; i += 1) {
    const id = randomUUID();
    questionIds.push(id);
    await prisma.quizQuestion.create({
      data: {
        id,
        quizId,
        seq: i + 1,
        prompt: { en: `Q${i}`, ja: `問${i}` },
        options: { a: { en: 'A', ja: 'エー' }, b: { en: 'B', ja: 'ビー' } },
        correctKey: 'a',
        explanation: { en: 'x', ja: 'エックス' },
      },
    });
  }

  return {
    workshopId,
    cohortId,
    sessionIds,
    quizId,
    questionIds,
    enrollmentId: enrollment.id,
    userId,
  };
}

async function cleanup(f: Fixture): Promise<void> {
  await prisma.certificate.deleteMany({ where: { enrollmentId: f.enrollmentId } });
  // progress_event is append-only (forbid_delete trigger). In tests we bypass the
  // trigger with SET LOCAL session_replication_role='replica' (superuser
  // DATABASE_URL) inside a transaction so it auto-resets on commit — production
  // never deletes these rows.
  await prisma.$transaction([
    prisma.$executeRawUnsafe(`SET LOCAL session_replication_role = 'replica'`),
    prisma.progressEvent.deleteMany({ where: { enrollmentId: f.enrollmentId } }),
  ]);
  await prisma.quizAttempt.deleteMany({ where: { enrollmentId: f.enrollmentId } });
  await prisma.attendance.deleteMany({ where: { enrollmentId: f.enrollmentId } });
  await prisma.quizQuestion.deleteMany({ where: { quizId: f.quizId } });
  await prisma.quiz.deleteMany({ where: { id: f.quizId } });
  await prisma.enrollment.deleteMany({ where: { id: f.enrollmentId } });
  await prisma.session.deleteMany({ where: { cohortId: f.cohortId } });
  await prisma.cohort.deleteMany({ where: { id: f.cohortId } });
  await prisma.workshop.deleteMany({ where: { id: f.workshopId } });
  await prisma.user.deleteMany({ where: { id: f.userId } });
}

async function markPresent(f: Fixture, n: number): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    await prisma.attendance.create({
      data: {
        enrollmentId: f.enrollmentId,
        sessionId: f.sessionIds[i]!,
        status: 'present',
        method: 'facilitator',
      },
    });
  }
}

async function passQuiz(f: Fixture): Promise<void> {
  await prisma.$transaction((tx) =>
    scoreQuizAttempt(tx, {
      quizId: f.quizId,
      enrollmentId: f.enrollmentId,
      answers: Object.fromEntries(f.questionIds.map((id) => [id, 'a'])),
    }),
  );
}

describe('resolveCompletionRule', () => {
  it('defaults to 80/70 and honors overrides + rejects out-of-range values', () => {
    expect(resolveCompletionRule(null)).toEqual({ attendance_pct: 80, quiz_pass_pct: 70 });
    expect(resolveCompletionRule({ attendance_pct: 100, quiz_pass_pct: 60 })).toEqual({
      attendance_pct: 100,
      quiz_pass_pct: 60,
    });
    // Bad values fall back to defaults (untrusted config).
    expect(resolveCompletionRule({ attendance_pct: 'nope', quiz_pass_pct: 999 })).toEqual({
      attendance_pct: 80,
      quiz_pass_pct: 70,
    });
  });
});

describe('completion rule — default 80/70', () => {
  let f: Fixture;
  beforeEach(async () => {
    f = await makeFixture({ sessions: 3 });
  });
  afterEach(async () => {
    await cleanup(f);
  });

  it('attend all 3 + pass quiz → completed + certificate issued', async () => {
    await markPresent(f, 3); // 100% ≥ 80%
    await passQuiz(f); // scoreQuizAttempt re-evaluates completion at the end

    const enrollment = await prisma.enrollment.findUnique({ where: { id: f.enrollmentId } });
    expect(enrollment?.status).toBe('completed');
    expect(enrollment?.completedAt).not.toBeNull();

    const cert = await prisma.certificate.findUnique({ where: { enrollmentId: f.enrollmentId } });
    expect(cert).not.toBeNull();
    expect(cert?.verifyCode.length).toBeGreaterThan(10);

    const completedEvent = await prisma.progressEvent.findFirst({
      where: { enrollmentId: f.enrollmentId, kind: 'completed' },
    });
    expect(completedEvent).not.toBeNull();
  });

  it('pass quiz but only 1/3 attendance → NOT completed, no certificate', async () => {
    await markPresent(f, 1); // 33% < 80%
    await passQuiz(f);

    const enrollment = await prisma.enrollment.findUnique({ where: { id: f.enrollmentId } });
    expect(enrollment?.status).toBe('active');
    expect(enrollment?.completedAt).toBeNull();
    const cert = await prisma.certificate.findUnique({ where: { enrollmentId: f.enrollmentId } });
    expect(cert).toBeNull();
  });

  it('full attendance but no passing quiz → NOT completed', async () => {
    await markPresent(f, 3);
    // Submit a failing attempt (both wrong).
    await prisma.$transaction((tx) =>
      scoreQuizAttempt(tx, {
        quizId: f.quizId,
        enrollmentId: f.enrollmentId,
        answers: Object.fromEntries(f.questionIds.map((id) => [id, 'b'])),
      }),
    );
    const enrollment = await prisma.enrollment.findUnique({ where: { id: f.enrollmentId } });
    expect(enrollment?.status).toBe('active');
    expect(enrollment?.completedAt).toBeNull();
  });

  it('is idempotent — re-evaluating after completion does not re-issue or re-fire', async () => {
    await markPresent(f, 3);
    await passQuiz(f);

    const status = await prisma.$transaction((tx) => evaluateCompletion(tx, f.enrollmentId));
    expect(status.completed).toBe(true);
    expect(status.justCompleted).toBe(false); // already completed on the quiz pass

    const completedEvents = await prisma.progressEvent.count({
      where: { enrollmentId: f.enrollmentId, kind: 'completed' },
    });
    expect(completedEvents).toBe(1);
    const certs = await prisma.certificate.count({ where: { enrollmentId: f.enrollmentId } });
    expect(certs).toBe(1);
  });
});

describe('completion rule — per-workshop override (100% attendance)', () => {
  let f: Fixture;
  beforeEach(async () => {
    f = await makeFixture({
      sessions: 3,
      completionRule: { attendance_pct: 100, quiz_pass_pct: 70 },
    });
  });
  afterEach(async () => {
    await cleanup(f);
  });

  it('2/3 attendance (67%) + pass → NOT completed under the 100% override', async () => {
    await markPresent(f, 2); // 67% < 100%
    await passQuiz(f);
    const enrollment = await prisma.enrollment.findUnique({ where: { id: f.enrollmentId } });
    expect(enrollment?.status).toBe('active');
    expect(enrollment?.completedAt).toBeNull();
  });

  it('3/3 attendance (100%) + pass → completed under the 100% override', async () => {
    await markPresent(f, 3);
    await passQuiz(f);
    const enrollment = await prisma.enrollment.findUnique({ where: { id: f.enrollmentId } });
    expect(enrollment?.status).toBe('completed');
    const cert = await prisma.certificate.findUnique({ where: { enrollmentId: f.enrollmentId } });
    expect(cert).not.toBeNull();
  });
});
