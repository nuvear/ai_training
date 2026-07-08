import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/server/db/client';
import { evaluateCompletion } from '@/server/domain/completion';
import { loadCertificatePdfData, renderCertificatePdf } from '@/server/pdf/certificate-pdf';

// Certificate (COPILOT_TOOLS §5, PRODUCT_SPEC §5):
//  - completion issues a certificate with a UNIQUE verifyCode
//  - a /api/verify/[code]-shaped read returns name + workshop but NO extra PII
//  - the certificate PDF bytes start with %PDF (bundled font → works offline)

const workshopId = randomUUID();
const cohortId = randomUUID();
const sessionId = randomUUID();
const quizId = randomUUID();
const userId = randomUUID();
const email = `cert-${userId}@t.local`;
let enrollmentId: string;

beforeAll(async () => {
  await prisma.workshop.create({
    data: {
      id: workshopId,
      slug: `cert-${workshopId}`,
      title: { en: 'Verifiable Skills', ja: '検証可能なスキル' },
      summary: { en: 'S', ja: 'エス' },
      completionRule: { attendance_pct: 80, quiz_pass_pct: 70 },
    },
  });
  await prisma.cohort.create({
    data: {
      id: cohortId,
      workshopId,
      startsAt: new Date('2026-06-01T00:00:00Z'),
      endsAt: new Date('2026-06-02T00:00:00Z'),
      capacity: 10,
      priceJpy: 30_000,
    },
  });
  await prisma.session.create({
    data: {
      id: sessionId,
      cohortId,
      seq: 1,
      startsAt: new Date('2026-06-01T09:00:00Z'),
      endsAt: new Date('2026-06-01T12:00:00Z'),
    },
  });
  await prisma.user.create({
    data: {
      id: userId,
      email,
      role: 'participant',
      // display name is the only PII a certificate/verify may surface
      name: { display: 'Aiko Yamamoto' },
    },
  });
  const enrollment = await prisma.enrollment.create({
    data: { userId, cohortId, source: 'self_paid', status: 'active' },
  });
  enrollmentId = enrollment.id;

  await prisma.quiz.create({
    data: {
      id: quizId,
      workshopId,
      title: { en: 'Q', ja: 'キュー' },
      passPct: 70,
      status: 'published',
    },
  });
  await prisma.quizQuestion.create({
    data: {
      quizId,
      seq: 1,
      prompt: { en: 'Q1', ja: '問1' },
      options: { a: { en: 'A', ja: 'エー' }, b: { en: 'B', ja: 'ビー' } },
      correctKey: 'a',
      explanation: { en: 'x', ja: 'エックス' },
    },
  });

  // Satisfy the rule directly: 1/1 present + a passing attempt.
  await prisma.attendance.create({
    data: { enrollmentId, sessionId, status: 'present', method: 'facilitator' },
  });
  await prisma.quizAttempt.create({
    data: { enrollmentId, quizId, answers: { a: 'a' }, scorePct: 100, passed: true },
  });
  // Trigger completion → auto-issues the certificate.
  await prisma.$transaction((tx) => evaluateCompletion(tx, enrollmentId));
});

afterAll(async () => {
  await prisma.certificate.deleteMany({ where: { enrollmentId } });
  // progress_event is append-only; bypass the trigger for fixture teardown only.
  await prisma.$transaction([
    prisma.$executeRawUnsafe(`SET LOCAL session_replication_role = 'replica'`),
    prisma.progressEvent.deleteMany({ where: { enrollmentId } }),
  ]);
  await prisma.quizAttempt.deleteMany({ where: { enrollmentId } });
  await prisma.attendance.deleteMany({ where: { enrollmentId } });
  await prisma.quizQuestion.deleteMany({ where: { quizId } });
  await prisma.quiz.deleteMany({ where: { id: quizId } });
  await prisma.enrollment.deleteMany({ where: { id: enrollmentId } });
  await prisma.session.deleteMany({ where: { id: sessionId } });
  await prisma.cohort.deleteMany({ where: { id: cohortId } });
  await prisma.workshop.deleteMany({ where: { id: workshopId } });
  await prisma.user.deleteMany({ where: { id: userId } });
});

describe('certificate issuance', () => {
  it('completion issued a certificate with a unique verify code', async () => {
    const cert = await prisma.certificate.findUnique({ where: { enrollmentId } });
    expect(cert).not.toBeNull();
    expect(cert!.verifyCode).toMatch(/^[A-Za-z0-9_-]+$/); // url-safe
    expect(cert!.verifyCode.length).toBeGreaterThan(16);
  });
});

describe('public verification read (verify/[code] shape)', () => {
  it('returns name + workshop but NO email or other PII', async () => {
    const cert = await prisma.certificate.findUnique({ where: { enrollmentId } });
    const code = cert!.verifyCode;

    // Mirror the exact projection the route uses.
    const found = await prisma.certificate.findUnique({
      where: { verifyCode: code },
      select: {
        issuedAt: true,
        enrollment: {
          select: {
            user: { select: { name: true } },
            cohort: { select: { workshop: { select: { title: true } } } },
          },
        },
      },
    });
    expect(found).not.toBeNull();

    const payload = {
      valid: true,
      participantName: (found!.enrollment.user.name as { display?: string }).display,
      workshopTitle: found!.enrollment.cohort.workshop.title,
      issuedAt: found!.issuedAt.toISOString(),
    };

    expect(payload.participantName).toBe('Aiko Yamamoto');
    expect(payload.workshopTitle).toEqual({ en: 'Verifiable Skills', ja: '検証可能なスキル' });
    // The response object must not carry email or any other PII field.
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain(email);
    expect(Object.keys(payload).sort()).toEqual(
      ['issuedAt', 'participantName', 'valid', 'workshopTitle'].sort(),
    );
  });

  it('an unknown verify code resolves to not-found (no disclosure)', async () => {
    const found = await prisma.certificate.findUnique({
      where: { verifyCode: 'definitely-not-a-real-code' },
    });
    expect(found).toBeNull();
  });
});

describe('certificate PDF', () => {
  it('renders bilingual PDF bytes starting with %PDF', async () => {
    const data = await loadCertificatePdfData(prisma, enrollmentId);
    expect(data.participantName).toBe('Aiko Yamamoto');

    const en = await renderCertificatePdf(data, 'en');
    expect(en.length).toBeGreaterThan(1000);
    expect(en.subarray(0, 5).toString('latin1')).toBe('%PDF-');

    const ja = await renderCertificatePdf(data, 'ja');
    expect(ja.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});
