import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/server/db/client';
import { proposeAction, canApprove } from '@/server/ai/ledger';
import { refundTier } from '@/server/ai/tools/refunds';
import type { SessionUser } from '@/server/auth/session';

// refund.execute is DYNAMICALLY tiered at the ¥10,000 boundary (PRODUCT_SPEC §7):
//   ≤ ¥10,000 → approve (staff or owner may approve)
//   > ¥10,000 → owner_only (only the owner may approve)
// The tier is computed server-side from the parsed input and stored on the
// ai_action; a caller cannot escalate or lower it.

const owner: SessionUser = {
  userId: randomUUID(),
  email: `rf-owner-${randomUUID()}@t.local`,
  role: 'owner',
  organizationId: null,
  locale: 'en',
  name: {},
};

beforeAll(async () => {
  await prisma.user.create({ data: { id: owner.userId, email: owner.email, role: 'owner' } });
});

afterAll(async () => {
  // ai_action is append-only (DB trigger); leave the ledger rows, drop the user.
  await prisma.user.deleteMany({ where: { id: owner.userId } });
});

describe('refundTier (pure server-side tier function)', () => {
  it('¥8,000 → approve; ¥10,000 (boundary) → approve; ¥50,000 → owner_only', () => {
    expect(refundTier({ paymentId: 'x', amount: 8_000, currency: 'JPY', reason: 'r' })).toBe(
      'approve',
    );
    expect(refundTier({ paymentId: 'x', amount: 10_000, currency: 'JPY', reason: 'r' })).toBe(
      'approve',
    );
    expect(refundTier({ paymentId: 'x', amount: 10_001, currency: 'JPY', reason: 'r' })).toBe(
      'owner_only',
    );
    expect(refundTier({ paymentId: 'x', amount: 50_000, currency: 'JPY', reason: 'r' })).toBe(
      'owner_only',
    );
  });
});

describe('refund.execute proposed ai_action carries the dynamic tier', () => {
  it('¥8,000 → approve tier; staff CAN approve, participant cannot', async () => {
    const action = await proposeAction(owner, {
      surface: 'copilot',
      toolName: 'refund.execute',
      input: { paymentId: randomUUID(), amount: 8_000, currency: 'JPY', reason: 'small' },
    });
    expect(action.tier).toBe('approve'); // authoritative, from dynamicTier(input)
    expect(canApprove('staff', action.tier)).toBe(true);
    expect(canApprove('owner', action.tier)).toBe(true);
    expect(canApprove('participant', action.tier)).toBe(false);
  });

  it('¥50,000 → owner_only tier; staff CANNOT approve, owner can', async () => {
    const action = await proposeAction(owner, {
      surface: 'copilot',
      toolName: 'refund.execute',
      input: { paymentId: randomUUID(), amount: 50_000, currency: 'JPY', reason: 'large' },
    });
    expect(action.tier).toBe('owner_only'); // escalated server-side by amount
    expect(canApprove('staff', action.tier)).toBe(false);
    expect(canApprove('owner', action.tier)).toBe(true);
  });
});
