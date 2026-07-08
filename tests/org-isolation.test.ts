import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/server/db/client';
import { readOrgProgress } from '@/server/domain/org-progress';

// Cross-org isolation for the org-progress read (CLAUDE.md invariant 8): org A's
// dashboard contains only org A's employees; org B's employees never appear. The
// sanctioned read (readOrgProgress) is self-scoped: every query filters by the
// requested organizationId (and employee ids derived from it), so it can never
// surface another org's rows.

const orgA = randomUUID();
const orgB = randomUUID();
const adminA = randomUUID();
const empA = randomUUID();
const adminB = randomUUID();
const empB = randomUUID();
const workshopId = randomUUID();
const cohortA = randomUUID();
const cohortB = randomUUID();

beforeAll(async () => {
  await prisma.organization.createMany({
    data: [
      {
        id: orgA,
        name: { en: 'Alpha', ja: 'アルファ' },
        billingEmail: `oa-${randomUUID()}@t.local`,
      },
      { id: orgB, name: { en: 'Beta', ja: 'ベータ' }, billingEmail: `ob-${randomUUID()}@t.local` },
    ],
  });
  await prisma.user.createMany({
    data: [
      { id: adminA, email: `oi-aa-${adminA}@t.local`, role: 'org_admin', organizationId: orgA },
      { id: empA, email: `oi-ea-${empA}@t.local`, role: 'participant', organizationId: orgA },
      { id: adminB, email: `oi-ab-${adminB}@t.local`, role: 'org_admin', organizationId: orgB },
      { id: empB, email: `oi-eb-${empB}@t.local`, role: 'participant', organizationId: orgB },
    ],
  });
  await prisma.workshop.create({
    data: {
      id: workshopId,
      slug: `oi-${workshopId}`,
      title: { en: 'Ops', ja: 'オプス' },
      summary: { en: 'S', ja: 'エス' },
    },
  });
  await prisma.cohort.createMany({
    data: [cohortA, cohortB].map((id) => ({
      id,
      workshopId,
      startsAt: new Date(Date.now() - 10 * 864e5),
      endsAt: new Date(Date.now() - 5 * 864e5),
      capacity: 10,
      priceJpy: 40_000,
    })),
  });
  await prisma.enrollment.createMany({
    data: [
      { userId: empA, cohortId: cohortA, source: 'org_seat', status: 'active' },
      { userId: empB, cohortId: cohortB, source: 'org_seat', status: 'active' },
    ],
  });
});

afterAll(async () => {
  await prisma.enrollment.deleteMany({ where: { cohortId: { in: [cohortA, cohortB] } } });
  await prisma.cohort.deleteMany({ where: { id: { in: [cohortA, cohortB] } } });
  await prisma.workshop.deleteMany({ where: { id: workshopId } });
  await prisma.user.deleteMany({ where: { id: { in: [adminA, empA, adminB, empB] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
});

describe('org-progress cross-org isolation', () => {
  it('org A progress contains only org A employees', async () => {
    const progress = await readOrgProgress(orgA);
    const ids = progress.employees.map((e) => e.userId);
    expect(ids).toContain(empA);
    expect(ids).not.toContain(empB);
    expect(ids).not.toContain(adminB); // admins are not participants
    // Enrollment aggregate is scoped to org A too.
    expect(progress.employees.find((e) => e.userId === empA)?.enrolledWorkshops).toContain('Ops');
  });

  it('org B progress contains only org B employees', async () => {
    const progress = await readOrgProgress(orgB);
    const ids = progress.employees.map((e) => e.userId);
    expect(ids).toContain(empB);
    expect(ids).not.toContain(empA);
  });

  it('never mixes an employee from the other org into either dashboard', async () => {
    const [a, b] = await Promise.all([readOrgProgress(orgA), readOrgProgress(orgB)]);
    expect(a.employees.map((e) => e.userId)).not.toContain(empB);
    expect(b.employees.map((e) => e.userId)).not.toContain(empA);
  });
});
