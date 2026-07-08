import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/index.js';
import { importContent } from '../src/server/content/importer';

// Deterministic seed for local dev, tests, and e2e. Idempotent (upserts on
// fixed IDs). Creates the owner + staff (global operators) and two organizations
// with an org_admin + participant each — the fixtures the RLS isolation test and
// the copilot flow rely on.
const prisma = new PrismaClient();

const OWNER_ID = '00000000-0000-0000-0000-0000000000a1';
const STAFF_ID = '00000000-0000-0000-0000-0000000000a2';

const ORG_A = '00000000-0000-0000-0000-000000000a01';
const ADMIN_A = '00000000-0000-0000-0000-000000000a02';
const MEMBER_A = '00000000-0000-0000-0000-000000000a03';

const ORG_B = '00000000-0000-0000-0000-000000000b01';
const ADMIN_B = '00000000-0000-0000-0000-000000000b02';
const MEMBER_B = '00000000-0000-0000-0000-000000000b03';

export const SEED = {
  ownerEmail: 'owner@workshopos.local',
  staffEmail: 'staff@workshopos.local',
  orgA: { id: ORG_A, adminEmail: 'admin-a@acme.example', memberEmail: 'member-a@acme.example' },
  orgB: { id: ORG_B, adminEmail: 'admin-b@globex.example', memberEmail: 'member-b@globex.example' },
};

async function main() {
  await prisma.organization.upsert({
    where: { id: ORG_A },
    update: {},
    create: {
      id: ORG_A,
      name: { en: 'Acme Corp', ja: 'アクメ株式会社' },
      billingEmail: 'billing@acme.example',
      locale: 'ja',
    },
  });
  await prisma.organization.upsert({
    where: { id: ORG_B },
    update: {},
    create: {
      id: ORG_B,
      name: { en: 'Globex', ja: 'グローベックス株式会社' },
      billingEmail: 'billing@globex.example',
      locale: 'ja',
    },
  });

  const users = [
    {
      id: OWNER_ID,
      email: SEED.ownerEmail,
      role: 'owner' as const,
      organizationId: null,
      locale: 'en' as const,
      name: { display: 'Rajkumar Rajagobalan', family: 'Rajagobalan', given: 'Rajkumar' },
    },
    {
      id: STAFF_ID,
      email: SEED.staffEmail,
      role: 'staff' as const,
      organizationId: null,
      locale: 'ja' as const,
      name: { display: 'Staff', given: 'Staff' },
    },
    {
      id: ADMIN_A,
      email: SEED.orgA.adminEmail,
      role: 'org_admin' as const,
      organizationId: ORG_A,
      locale: 'ja' as const,
      name: { display: 'Admin A', given: 'A' },
    },
    {
      id: MEMBER_A,
      email: SEED.orgA.memberEmail,
      role: 'participant' as const,
      organizationId: ORG_A,
      locale: 'ja' as const,
      name: { display: 'Member A', given: 'A' },
    },
    {
      id: ADMIN_B,
      email: SEED.orgB.adminEmail,
      role: 'org_admin' as const,
      organizationId: ORG_B,
      locale: 'ja' as const,
      name: { display: 'Admin B', given: 'B' },
    },
    {
      id: MEMBER_B,
      email: SEED.orgB.memberEmail,
      role: 'participant' as const,
      organizationId: ORG_B,
      locale: 'ja' as const,
      name: { display: 'Member B', given: 'B' },
    },
  ];

  for (const u of users) {
    await prisma.user.upsert({
      where: { id: u.id },
      update: { role: u.role, organizationId: u.organizationId, name: u.name },
      create: u,
    });
  }

  console.info(`Seeded ${users.length} users across 2 organizations.`);

  // Import the IDEAGE content library (frontmatter → catalog).
  const result = await importContent(prisma);
  console.info(
    `Imported ${result.imported} workshops (${result.published} published) from content/ideage.`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
