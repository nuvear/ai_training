import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/server/db/client';
import { readOrgProgress } from '@/server/domain/org-progress';

// THE privacy boundary (PRODUCT_SPEC §2): an org admin sees aggregate ratings +
// completion, but NEVER the free-text reflection (Feedback.textBody). Enforced at
// the query layer by getOrgProgress, which never selects text_body.

const orgId = randomUUID();
const adminId = randomUUID();
const empId = randomUUID();
const workshopId = randomUUID();
const cohortId = randomUUID();

// A distinctive secret so a deep scan can prove it never appears in the result.
const SECRET_REFLECTION =
  'CONFIDENTIAL_REFLECTION_a7f3e9d1: my manager was overbearing and I felt unsafe.';

beforeAll(async () => {
  await prisma.organization.create({
    data: {
      id: orgId,
      name: { en: 'Privco', ja: 'プライブコ' },
      billingEmail: `pv-${randomUUID()}@t.local`,
    },
  });
  await prisma.user.createMany({
    data: [
      {
        id: adminId,
        email: `pv-admin-${adminId}@t.local`,
        role: 'org_admin',
        organizationId: orgId,
      },
      { id: empId, email: `pv-emp-${empId}@t.local`, role: 'participant', organizationId: orgId },
    ],
  });
  await prisma.workshop.create({
    data: {
      id: workshopId,
      slug: `pv-${workshopId}`,
      title: { en: 'Leadership', ja: 'リーダーシップ' },
      summary: { en: 'S', ja: 'エス' },
    },
  });
  await prisma.cohort.create({
    data: {
      id: cohortId,
      workshopId,
      startsAt: new Date(Date.now() - 30 * 864e5),
      endsAt: new Date(Date.now() - 20 * 864e5),
      capacity: 10,
      priceJpy: 40_000,
    },
  });
  await prisma.enrollment.create({
    data: {
      userId: empId,
      cohortId,
      source: 'org_seat',
      status: 'completed',
      completedAt: new Date(),
    },
  });
  await prisma.feedback.create({
    data: {
      cohortId,
      userId: empId,
      ratings: { overall: 4, pace: 5 },
      textBody: SECRET_REFLECTION,
      language: 'en',
    },
  });
});

afterAll(async () => {
  await prisma.feedback.deleteMany({ where: { cohortId } });
  await prisma.enrollment.deleteMany({ where: { cohortId } });
  await prisma.cohort.deleteMany({ where: { id: cohortId } });
  await prisma.workshop.deleteMany({ where: { id: workshopId } });
  await prisma.user.deleteMany({ where: { id: { in: [adminId, empId] } } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
});

/** Recursively scan any value for a needle string. */
function deepContains(value: unknown, needle: string): boolean {
  if (typeof value === 'string') return value.includes(needle);
  if (Array.isArray(value)) return value.some((v) => deepContains(v, needle));
  if (value && typeof value === 'object') {
    return Object.values(value).some((v) => deepContains(v, needle));
  }
  return false;
}

describe('org-progress privacy boundary', () => {
  it('returns aggregate rating + completion, but NO free-text reflection anywhere', async () => {
    const progress = await readOrgProgress(orgId);

    // Aggregate rating is present as a NUMBER (mean of overall = 4).
    expect(progress.avgRating).toBe(4);
    // Completion is surfaced.
    expect(progress.completions).toBe(1);
    const emp = progress.employees.find((e) => e.userId === empId);
    expect(emp).toBeDefined();
    expect(emp?.completions).toBe(1);
    expect(emp?.statuses).toContain('completed');
    expect(emp?.enrolledWorkshops).toContain('Leadership');
    // M4 placeholders — never fabricated.
    expect(emp?.attendancePct).toBeNull();
    expect(emp?.quizAverage).toBeNull();

    // The reflection text must NOT appear anywhere in the result (deep scan).
    expect(deepContains(progress, SECRET_REFLECTION)).toBe(false);
    expect(deepContains(progress, 'CONFIDENTIAL_REFLECTION')).toBe(false);
    expect(JSON.stringify(progress)).not.toContain('textBody');
  });

  it('the reflection really exists in the DB (guard against a false pass)', async () => {
    const fb = await prisma.feedback.findFirst({ where: { cohortId } });
    expect(fb?.textBody).toBe(SECRET_REFLECTION);
  });
});
