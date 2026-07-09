import 'server-only';
import { randomBytes, createHash } from 'node:crypto';
import { prisma } from '@/server/db/client';
import { sendMail, isMailConfigured } from '@/server/email/send';
import type { SessionUser } from './session';

const TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Issues a one-time sign-in link. Only the token's hash is stored. Returns the
 * dev login URL when mail is console-delivered so local + e2e flows can follow
 * the real token path without a mail server.
 */
export async function requestMagicLink(
  rawEmail: string,
): Promise<{ ok: true; devLoginUrl?: string }> {
  const email = normalizeEmail(rawEmail);
  const token = randomBytes(32).toString('base64url');

  await prisma.magicLinkToken.create({
    data: {
      email,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    },
  });

  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
  const url = `${appUrl}/api/auth/callback?token=${token}`;

  await sendMail({
    to: email,
    subject: 'Your WorkshopOS sign-in link / サインインリンク',
    text: `Sign in to WorkshopOS:\n${url}\n\nThis link expires in 15 minutes.\n\nWorkshopOS へのサインイン:\n${url}\n\nこのリンクは15分で無効になります。`,
  });

  return isMailConfigured() ? { ok: true } : { ok: true, devLoginUrl: url };
}

/**
 * Verifies and single-uses a token, returning the session user. Creates a
 * participant account on first sign-in. Returns null for invalid/expired/used
 * tokens. Runs as the DB owner (no session yet), so RLS does not apply here.
 */
export async function consumeMagicLink(token: string): Promise<SessionUser | null> {
  if (!token) return null;
  const record = await prisma.magicLinkToken.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (!record || record.consumedAt || record.expiresAt < new Date()) return null;

  await prisma.magicLinkToken.update({
    where: { id: record.id },
    data: { consumedAt: new Date() },
  });

  const user = await prisma.user.upsert({
    where: { email: record.email },
    update: {},
    create: { email: record.email, role: 'participant', name: {} },
  });

  return {
    userId: user.id,
    email: user.email,
    role: user.role,
    organizationId: user.organizationId,
    locale: user.locale,
    name: (user.name as SessionUser['name']) ?? {},
  };
}
