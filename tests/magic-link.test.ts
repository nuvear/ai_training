import { describe, it, expect, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/server/db/client';
import { requestMagicLink, consumeMagicLink } from '@/server/auth/magic-link';

const email = `ml-${randomUUID()}@t.local`;

afterAll(async () => {
  await prisma.magicLinkToken.deleteMany({ where: { email } });
  await prisma.user.deleteMany({ where: { email } });
});

describe('email magic-link auth', () => {
  it('issues a dev login link when no mail server is configured', async () => {
    const res = await requestMagicLink(email);
    expect(res.ok).toBe(true);
    expect(res.devLoginUrl).toMatch(/\/api\/auth\/callback\?token=/);
  });

  it('consumes a valid token once, creating a participant', async () => {
    const res = await requestMagicLink(email);
    const token = new URL(res.devLoginUrl!).searchParams.get('token')!;

    const user = await consumeMagicLink(token);
    expect(user?.email).toBe(email);
    expect(user?.role).toBe('participant');

    // single-use: a replay fails
    expect(await consumeMagicLink(token)).toBeNull();
  });

  it('rejects an unknown token', async () => {
    expect(await consumeMagicLink('not-a-real-token')).toBeNull();
  });

  it('normalizes email case', async () => {
    const mixed = `MiXeD-${randomUUID()}@T.LOCAL`;
    const res = await requestMagicLink(mixed);
    const token = new URL(res.devLoginUrl!).searchParams.get('token')!;
    const user = await consumeMagicLink(token);
    expect(user?.email).toBe(mixed.toLowerCase());
    await prisma.user.deleteMany({ where: { email: mixed.toLowerCase() } });
    await prisma.magicLinkToken.deleteMany({ where: { email: mixed.toLowerCase() } });
  });
});
