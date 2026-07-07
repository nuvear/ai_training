import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/server/db/client';
import { withOrgContext, tenantContext } from '@/server/db/rls';
import type { Role } from '@/generated/prisma';

// CLAUDE.md invariant 8 + M0 exit criterion: an org admin cannot read another
// org's rows. Proven at the DB level via the RLS policies.
const orgA = randomUUID();
const orgB = randomUUID();
const adminA = randomUUID();
const memberA = randomUUID();
const adminB = randomUUID();

function ctx(userId: string, role: Role, organizationId: string | null) {
  return tenantContext({ userId, role, organizationId });
}

beforeAll(async () => {
  await prisma.organization.createMany({
    data: [
      { id: orgA, name: { en: 'A', ja: 'エー' }, billingEmail: 'a@t.local' },
      { id: orgB, name: { en: 'B', ja: 'ビー' }, billingEmail: 'b@t.local' },
    ],
  });
  await prisma.user.createMany({
    data: [
      { id: adminA, email: `aa-${adminA}@t.local`, role: 'org_admin', organizationId: orgA },
      { id: memberA, email: `ma-${memberA}@t.local`, role: 'participant', organizationId: orgA },
      { id: adminB, email: `ab-${adminB}@t.local`, role: 'org_admin', organizationId: orgB },
    ],
  });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [adminA, memberA, adminB] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
});

describe('row-level security org isolation', () => {
  it('org A admin sees only org A users', async () => {
    const users = await withOrgContext(ctx(adminA, 'org_admin', orgA), (tx) =>
      tx.user.findMany({ where: { id: { in: [adminA, memberA, adminB] } } }),
    );
    const ids = users.map((u) => u.id);
    expect(ids).toContain(adminA);
    expect(ids).toContain(memberA);
    expect(ids).not.toContain(adminB); // cross-org read fails
    expect(users.every((u) => u.organizationId === orgA)).toBe(true);
  });

  it('org A admin cannot fetch org B admin by id', async () => {
    const found = await withOrgContext(ctx(adminA, 'org_admin', orgA), (tx) =>
      tx.user.findUnique({ where: { id: adminB } }),
    );
    expect(found).toBeNull();
  });

  it('org A admin sees only org A organization row', async () => {
    const orgs = await withOrgContext(ctx(adminA, 'org_admin', orgA), (tx) =>
      tx.organization.findMany({ where: { id: { in: [orgA, orgB] } } }),
    );
    expect(orgs.map((o) => o.id)).toEqual([orgA]);
  });

  it('owner (global operator) sees both orgs', async () => {
    const orgs = await withOrgContext(ctx(randomUUID(), 'owner', null), (tx) =>
      tx.organization.findMany({ where: { id: { in: [orgA, orgB] } } }),
    );
    expect(orgs.map((o) => o.id).sort()).toEqual([orgA, orgB].sort());
  });
});
