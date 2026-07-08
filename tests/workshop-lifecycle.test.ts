import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/server/db/client';
import { proposeAndAutoExecute, proposeAction, approveAndExecute } from '@/server/ai/ledger';
import { publishGate } from '@/server/ai/tools/workshops';
import { BilingualIncompleteError } from '@/server/domain/errors';
import type { SessionUser } from '@/server/auth/session';

const owner: SessionUser = {
  userId: randomUUID(),
  email: `wsowner-${randomUUID()}@t.local`,
  role: 'owner',
  organizationId: null,
  locale: 'en',
  name: {},
};

const created: string[] = [];

beforeAll(async () => {
  await prisma.user.create({ data: { id: owner.userId, email: owner.email, role: 'owner' } });
});

afterAll(async () => {
  await prisma.workshop.deleteMany({ where: { id: { in: created } } });
  await prisma.user.deleteMany({ where: { id: owner.userId } });
});

async function createDraft(titleEn: string): Promise<string> {
  const action = await proposeAndAutoExecute(owner, {
    surface: 'copilot',
    toolName: 'workshop.create',
    input: { title: { en: titleEn }, summary: { en: `${titleEn} summary` }, level: 'intro' },
  });
  expect(action.status).toBe('executed');
  const id = (action.output as { workshopId: string }).workshopId;
  created.push(id);
  return id;
}

describe('workshop lifecycle: author EN → localize JA → review → publish', () => {
  it('creates an EN-only draft', async () => {
    const id = await createDraft('Test Workshop A');
    const ws = await prisma.workshop.findUnique({ where: { id } });
    expect(ws?.status).toBe('draft');
    expect((ws?.title as { en?: string; ja?: string }).en).toBe('Test Workshop A');
    expect((ws?.title as { en?: string; ja?: string }).ja).toBeUndefined();
  });

  it('localizes to JA (auto) and flags ai_localized', async () => {
    const id = await createDraft('Test Workshop B');
    const action = await proposeAndAutoExecute(owner, {
      surface: 'copilot',
      toolName: 'content.localize',
      input: { entityType: 'workshop', entityId: id, targetLocale: 'ja', register: 'polite' },
    });
    expect(action.status).toBe('executed');
    const ws = await prisma.workshop.findUnique({ where: { id } });
    // stub echoes source, so JA is now non-empty
    expect((ws?.title as { ja?: string }).ja).toBeTruthy();
    expect((ws?.localizationReview as Record<string, string>).ja).toBe('ai_localized');
  });

  it('mark_reviewed is approve-tier: proposed, then executed on approval', async () => {
    const id = await createDraft('Test Workshop C');
    await proposeAndAutoExecute(owner, {
      surface: 'copilot',
      toolName: 'content.localize',
      input: { entityType: 'workshop', entityId: id, targetLocale: 'ja', register: 'polite' },
    });
    const proposed = await proposeAction(owner, {
      surface: 'copilot',
      toolName: 'content.mark_reviewed',
      input: { entityType: 'workshop', entityId: id, locale: 'ja' },
    });
    expect(proposed.status).toBe('proposed'); // blocked without approval
    const executed = await approveAndExecute(owner, proposed.id);
    expect(executed.status).toBe('executed');
    const ws = await prisma.workshop.findUnique({ where: { id } });
    expect((ws?.localizationReview as Record<string, string>).ja).toBe('human_reviewed');
  });

  it('publishes only after both locales exist (approve-tier)', async () => {
    const id = await createDraft('Test Workshop D');
    await proposeAndAutoExecute(owner, {
      surface: 'copilot',
      toolName: 'content.localize',
      input: { entityType: 'workshop', entityId: id, targetLocale: 'ja', register: 'polite' },
    });
    const proposed = await proposeAction(owner, {
      surface: 'copilot',
      toolName: 'workshop.publish',
      input: { workshopId: id },
    });
    const executed = await approveAndExecute(owner, proposed.id);
    expect(executed.status).toBe('executed');
    const ws = await prisma.workshop.findUnique({ where: { id } });
    expect(ws?.status).toBe('published');
  });

  it('publishing an EN-only workshop fails with a typed bilingual error', async () => {
    const id = await createDraft('Test Workshop E'); // never localized
    const proposed = await proposeAction(owner, {
      surface: 'copilot',
      toolName: 'workshop.publish',
      input: { workshopId: id },
    });
    const result = await approveAndExecute(owner, proposed.id);
    // the handler threw BilingualIncompleteError → ledger records it as failed
    expect(result.status).toBe('failed');
    expect((result.output as { error: string }).error).toMatch(/both locales/i);
    const ws = await prisma.workshop.findUnique({ where: { id } });
    expect(ws?.status).toBe('draft'); // not published
  });

  it('publishGate throws BilingualIncompleteError directly (typed)', () => {
    expect(() =>
      publishGate({ title: { en: 'x' }, summary: { en: 'y' }, description: {}, outcomes: {} }),
    ).toThrow(BilingualIncompleteError);
    expect(() =>
      publishGate({
        title: { en: 'x', ja: 'ex' },
        summary: { en: 'y', ja: 'wai' },
        description: {},
        outcomes: {},
      }),
    ).not.toThrow();
  });
});
