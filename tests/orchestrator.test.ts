import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/server/db/client';
import { planCommand, runPlan } from '@/server/ai/orchestrator';
import { approveAndExecute } from '@/server/ai/ledger';
import type { SessionUser } from '@/server/auth/session';

// M5 exit criteria 1 & 2: the September-launch command in BOTH languages
// produces the canonical 5-step plan (correct toolNames + tiers), the ledger
// holds a parent + 5 children, and the dependency-aware execution model runs
// auto steps, queues approve steps, threads $refs, and completes after approval.
// Fully offline: tests/setup.ts blanks ANTHROPIC_API_KEY → the stub planner and
// stub tool outputs run deterministically.

const owner: SessionUser = {
  userId: randomUUID(),
  email: `orch-owner-${randomUUID()}@t.local`,
  role: 'owner',
  organizationId: null,
  locale: 'en',
  name: {},
};

const EN_COMMAND =
  'Launch a 3-session Design Thinking cohort in September, ¥45,000, cap 30, early-bird 20% off until Aug 15.';
const JA_COMMAND =
  '9月開講のデザイン思考コホート（全3回・45,000円・定員30名）を作成し、8月15日まで20%早割を設定して。';

const EXPECTED_TOOLS = [
  'cohort.create',
  'landing.generate_variants',
  'promo.create',
  'campaign.draft_sequence',
  'campaign.approve_and_schedule',
];
const EXPECTED_TIERS = ['approve', 'auto', 'approve', 'auto', 'approve'];

let workshopId: string;
const planParentIds: string[] = [];
const createdCohortIds: string[] = [];
const createdPromoIds: string[] = [];

beforeAll(async () => {
  await prisma.user.create({ data: { id: owner.userId, email: owner.email, role: 'owner' } });
  // The plan's promo.create emits the fixed code HAYAWARI20 (M5 exit criterion).
  // Remove any pre-existing one (e.g. from the seed) so the create step succeeds.
  await prisma.promoCode.deleteMany({ where: { code: 'HAYAWARI20' } });
  // Ensure the Design Thinking workshop the launch command resolves exists.
  const existing = await prisma.workshop.findUnique({ where: { slug: 'design-thinking' } });
  if (existing) {
    workshopId = existing.id;
  } else {
    const ws = await prisma.workshop.create({
      data: {
        slug: 'design-thinking',
        title: { en: 'Design Thinking in Practice', ja: '実践デザイン思考' },
        summary: {
          en: 'A hands-on design thinking workshop.',
          ja: '実践型のデザイン思考ワークショップ。',
        },
        level: 'intermediate',
        status: 'published',
      },
    });
    workshopId = ws.id;
  }
});

afterAll(async () => {
  // ai_action is append-only (a DB guard forbids deletes), so plan rows are left
  // in place — the initiatedBy FK is set null when the test owner is removed.
  await prisma.campaign.deleteMany({ where: { cohortId: { in: createdCohortIds } } });
  await prisma.landingPage.deleteMany({ where: { workshopId } });
  await prisma.cohort.deleteMany({ where: { id: { in: createdCohortIds } } });
  await prisma.promoCode.deleteMany({ where: { id: { in: createdPromoIds } } });
  await prisma.promoCode.deleteMany({ where: { code: 'HAYAWARI20' } });
  await prisma.user.deleteMany({ where: { id: owner.userId } });
});

describe.each([
  ['EN', EN_COMMAND],
  ['JA', JA_COMMAND],
])('launch plan (%s command)', (_label, command) => {
  it('plans the canonical 5 steps with correct toolNames and tiers', async () => {
    const plan = await planCommand(owner, command, _label === 'JA' ? 'ja' : 'en');
    planParentIds.push(plan.parentId);

    expect(plan.steps).toHaveLength(5);
    expect(plan.steps.map((s) => s.toolName)).toEqual(EXPECTED_TOOLS);
    expect(plan.steps.map((s) => s.tier)).toEqual(EXPECTED_TIERS);

    // Ledger: a parent copilot.plan plus 5 children with those tiers.
    const parent = await prisma.aiAction.findUnique({ where: { id: plan.parentId } });
    expect(parent?.toolName).toBe('copilot.plan');
    expect(parent?.tier).toBe('auto');
    expect(parent?.status).toBe('proposed');

    const children = await prisma.aiAction.findMany({
      where: { parentId: plan.parentId },
      orderBy: { createdAt: 'asc' },
    });
    expect(children).toHaveLength(5);
    expect(children.map((c) => c.toolName)).toEqual(EXPECTED_TOOLS);
    expect(children.map((c) => c.tier)).toEqual(EXPECTED_TIERS);
    expect(children.every((c) => c.status === 'proposed')).toBe(true);
  });
});

describe('full launch execution flow (dependency-aware + resume on approval)', () => {
  it('runs auto steps, queues approve steps, threads $refs, and completes after approval', async () => {
    const plan = await planCommand(owner, EN_COMMAND, 'en');
    planParentIds.push(plan.parentId);
    expect(plan.steps).toHaveLength(5);
    const [step1, step2, step3, step4, step5] = plan.steps as [
      (typeof plan.steps)[number],
      (typeof plan.steps)[number],
      (typeof plan.steps)[number],
      (typeof plan.steps)[number],
      (typeof plan.steps)[number],
    ];

    // Initial run: step 2 (landing, no deps, auto) executes; steps 1 & 3
    // (approve) stay proposed; steps 4 & 5 stay pending (dep on 1 / 4).
    const first = await runPlan(owner, plan.parentId);
    expect(first.status).toBe('running');

    const afterRun = await prisma.aiAction.findMany({ where: { parentId: plan.parentId } });
    const status = (id: string) => afterRun.find((a) => a.id === id)?.status;
    expect(status(step2.actionId)).toBe('executed'); // landing.generate_variants
    expect(status(step1.actionId)).toBe('proposed'); // cohort.create (approve)
    expect(status(step3.actionId)).toBe('proposed'); // promo.create (approve)
    expect(status(step4.actionId)).toBe('proposed'); // campaign.draft_sequence (pending on step 1)
    expect(status(step5.actionId)).toBe('proposed'); // approve_and_schedule (pending on step 4)

    // Approve step 1 (cohort.create) → its output.cohortId unblocks step 4
    // (auto), which runs; step 5 then becomes queued for approval (approve).
    const approvedStep1 = await approveAndExecute(owner, step1.actionId);
    expect(approvedStep1.status).toBe('executed');
    const cohortId = (approvedStep1.output as { cohortId: string }).cohortId;
    createdCohortIds.push(cohortId);

    const afterApprove1 = await prisma.aiAction.findMany({ where: { parentId: plan.parentId } });
    const status2 = (id: string) => afterApprove1.find((a) => a.id === id)?.status;
    expect(status2(step4.actionId)).toBe('executed'); // campaign.draft_sequence ran
    expect(status2(step5.actionId)).toBe('proposed'); // approve_and_schedule queued

    // The campaign step resolved cohortId from step 1's output (the $ref threaded).
    const step4Row = afterApprove1.find((a) => a.id === step4.actionId);
    const campaignId = (step4Row?.output as { campaignId: string }).campaignId;
    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    expect(campaign?.cohortId).toBe(cohortId);

    // Approve step 3 (promo.create) — independent approve step.
    const approvedStep3 = await approveAndExecute(owner, step3.actionId);
    expect(approvedStep3.status).toBe('executed');
    createdPromoIds.push((approvedStep3.output as { promoCodeId: string }).promoCodeId);

    // Approve step 5 (approve_and_schedule). Its campaignId $ref resolves from
    // step 4's output at approval time.
    const approvedStep5 = await approveAndExecute(owner, step5.actionId);
    expect(approvedStep5.status).toBe('executed');
    expect((approvedStep5.output as { campaignId: string }).campaignId).toBe(campaignId);

    // All 5 children executed → parent executed.
    const finalChildren = await prisma.aiAction.findMany({ where: { parentId: plan.parentId } });
    expect(finalChildren.every((c) => c.status === 'executed')).toBe(true);
    const parent = await prisma.aiAction.findUnique({ where: { id: plan.parentId } });
    expect(parent?.status).toBe('executed');
  });

  it('produces a minimal empty plan for an unrecognized command (no crash)', async () => {
    const plan = await planCommand(owner, 'what is the weather today', 'en');
    planParentIds.push(plan.parentId);
    expect(plan.steps).toHaveLength(0);
    const parent = await prisma.aiAction.findUnique({ where: { id: plan.parentId } });
    expect(parent?.toolName).toBe('copilot.plan');
  });
});
