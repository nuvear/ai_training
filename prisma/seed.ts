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

  // A bookable, priced cohort so the catalog has something to purchase (M2
  // checkout target), plus the HAYAWARI20 early-bird promo used in test vectors.
  const COHORT_ID = '00000000-0000-0000-0000-00000000c001';
  const discernment = await prisma.workshop.findUnique({
    where: { slug: 'ai-fluency-discernment' },
  });
  if (discernment) {
    await prisma.cohort.upsert({
      where: { id: COHORT_ID },
      update: {},
      create: {
        id: COHORT_ID,
        workshopId: discernment.id,
        status: 'open',
        startsAt: new Date('2026-09-08T01:00:00Z'),
        endsAt: new Date('2026-09-22T03:00:00Z'),
        capacity: 30,
        priceJpy: 45000, // yen
        priceUsd: 31000, // cents → $310.00
        format: 'online',
        facilitatorId: OWNER_ID,
      },
    });
  }
  await prisma.promoCode.upsert({
    where: { code: 'HAYAWARI20' },
    update: {},
    create: {
      code: 'HAYAWARI20',
      type: 'early_bird',
      value: 20, // 20% off
      validUntil: new Date('2026-12-31T00:00:00Z'),
      createdBy: 'human',
    },
  });
  console.info('Seeded 1 bookable cohort (¥45,000) + promo HAYAWARI20.');

  // ── M4 certificate-flow fixtures (deterministic, idempotent) ────────────────
  // Referenced by e2e/certificate-flow.spec.ts. Fixed ids so the e2e can drive
  // attendance + a passing quiz attempt for member-a on cohort c001 and land a
  // certificate. Only created when the discernment workshop/cohort exist.
  //
  //   SESSION_1 = 00000000-0000-0000-0000-0000005e5501  (seq 1)
  //   SESSION_2 = 00000000-0000-0000-0000-0000005e5502  (seq 2)
  //   SESSION_3 = 00000000-0000-0000-0000-0000005e5503  (seq 3)
  //   ENROLLMENT (member-a on c001) = 00000000-0000-0000-0000-0000000e0401
  //   QUIZ (ai-fluency-discernment)  = 00000000-0000-0000-0000-000000009401
  //   QUIZ_Q1 = 00000000-0000-0000-0000-0000009400a1 (correctKey 'a')
  //   QUIZ_Q2 = 00000000-0000-0000-0000-0000009400a2 (correctKey 'b')
  //   QUIZ_Q3 = 00000000-0000-0000-0000-0000009400a3 (correctKey 'c')
  const SESSION_1 = '00000000-0000-0000-0000-0000005e5501';
  const SESSION_2 = '00000000-0000-0000-0000-0000005e5502';
  const SESSION_3 = '00000000-0000-0000-0000-0000005e5503';
  const M4_ENROLLMENT = '00000000-0000-0000-0000-0000000e0401';
  const M4_QUIZ = '00000000-0000-0000-0000-000000009401';
  const M4_Q1 = '00000000-0000-0000-0000-0000009400a1';
  const M4_Q2 = '00000000-0000-0000-0000-0000009400a2';
  const M4_Q3 = '00000000-0000-0000-0000-0000009400a3';

  if (discernment) {
    const sessions = [
      {
        id: SESSION_1,
        seq: 1,
        startsAt: new Date('2026-09-08T01:00:00Z'),
        endsAt: new Date('2026-09-08T03:00:00Z'),
        agenda: { en: 'Session 1 — Foundations', ja: 'セッション1 — 基礎' },
      },
      {
        id: SESSION_2,
        seq: 2,
        startsAt: new Date('2026-09-15T01:00:00Z'),
        endsAt: new Date('2026-09-15T03:00:00Z'),
        agenda: { en: 'Session 2 — Discernment', ja: 'セッション2 — 見極め' },
      },
      {
        id: SESSION_3,
        seq: 3,
        startsAt: new Date('2026-09-22T01:00:00Z'),
        endsAt: new Date('2026-09-22T03:00:00Z'),
        agenda: { en: 'Session 3 — Practice', ja: 'セッション3 — 実践' },
      },
    ];
    for (const s of sessions) {
      await prisma.session.upsert({
        where: { id: s.id },
        update: { seq: s.seq, startsAt: s.startsAt, endsAt: s.endsAt, agenda: s.agenda },
        create: {
          id: s.id,
          cohortId: COHORT_ID,
          seq: s.seq,
          startsAt: s.startsAt,
          endsAt: s.endsAt,
          agenda: s.agenda,
        },
      });
    }

    // Active enrollment of member-a into cohort c001 (comp source). Not
    // pre-completed — the e2e drives it to completion.
    await prisma.enrollment.upsert({
      where: { id: M4_ENROLLMENT },
      update: {},
      create: {
        id: M4_ENROLLMENT,
        userId: MEMBER_A,
        cohortId: COHORT_ID,
        source: 'comp',
        status: 'active',
      },
    });

    // Published quiz with 3 bilingual questions and KNOWN correct keys, passPct 70.
    await prisma.quiz.upsert({
      where: { id: M4_QUIZ },
      update: { status: 'published', passPct: 70 },
      create: {
        id: M4_QUIZ,
        workshopId: discernment.id,
        title: { en: 'AI Fluency — Discernment Check', ja: 'AIフルエンシー — 見極めチェック' },
        passPct: 70,
        status: 'published',
      },
    });
    const questions = [
      {
        id: M4_Q1,
        seq: 1,
        prompt: {
          en: 'What is the first step in discerning AI output?',
          ja: 'AIの出力を見極める最初のステップは？',
        },
        options: {
          a: { en: 'Verify against a trusted source', ja: '信頼できる情報源と照合する' },
          b: { en: 'Accept it as fact', ja: '事実として受け入れる' },
          c: { en: 'Ignore it entirely', ja: '完全に無視する' },
        },
        correctKey: 'a',
      },
      {
        id: M4_Q2,
        seq: 2,
        prompt: {
          en: 'How should untrusted content be treated?',
          ja: '信頼できないコンテンツはどう扱うべきか？',
        },
        options: {
          a: { en: 'As executable instructions', ja: '実行可能な指示として' },
          b: { en: 'As data, never as instructions', ja: 'データとして、決して指示として扱わない' },
          c: { en: 'As always correct', ja: '常に正しいものとして' },
        },
        correctKey: 'b',
      },
      {
        id: M4_Q3,
        seq: 3,
        prompt: {
          en: 'Which practice supports responsible AI use?',
          ja: '責任あるAI利用を支える実践はどれか？',
        },
        options: {
          a: { en: 'Skipping human review', ja: '人間のレビューを省く' },
          b: { en: 'Hiding AI involvement', ja: 'AIの関与を隠す' },
          c: { en: 'Keeping a human in the loop', ja: '人間を判断の輪に残す' },
        },
        correctKey: 'c',
      },
    ];
    for (const q of questions) {
      await prisma.quizQuestion.upsert({
        where: { id: q.id },
        update: {
          seq: q.seq,
          prompt: q.prompt,
          options: q.options,
          correctKey: q.correctKey,
        },
        create: {
          id: q.id,
          quizId: M4_QUIZ,
          seq: q.seq,
          prompt: q.prompt,
          options: q.options,
          correctKey: q.correctKey,
        },
      });
    }
    console.info('Seeded M4 certificate-flow fixtures (3 sessions, enrollment, published quiz).');
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
