import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/server/db/client';
import type { BilingualText } from '@/server/ai/i18n-content';
import { enforceRateLimit, RATE_LIMITS } from '@/server/rate-limit';

// GET /api/verify/[code] — PUBLIC (UNAUTHENTICATED) certificate verification.
// Looks up a certificate by verifyCode and returns ONLY { valid, participantName,
// workshopTitle, issuedAt }. Never leaks PII beyond the participant's display name
// and the workshop title (no email, no org, no scores). Queries via the base
// prisma client (certificate RLS allows the owner connection); an unknown code
// returns { valid: false } without disclosing anything.

function displayName(name: unknown, fallback: string): string {
  const n = (name ?? {}) as { display?: string; given?: string; family?: string };
  if (n.display?.trim()) return n.display.trim();
  const parts = [n.family, n.given].filter((p): p is string => Boolean(p?.trim()));
  if (parts.length) return parts.join(' ');
  return fallback;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const limited = enforceRateLimit(req, RATE_LIMITS.verify);
  if (limited) return limited;

  const { code } = await params;

  const certificate = await prisma.certificate.findUnique({
    where: { verifyCode: code },
    select: {
      issuedAt: true,
      enrollment: {
        select: {
          // display name only — NEVER the email
          user: { select: { name: true } },
          cohort: { select: { workshop: { select: { title: true } } } },
        },
      },
    },
  });

  if (!certificate) {
    return NextResponse.json({ valid: false }, { status: 404 });
  }

  const title = certificate.enrollment.cohort.workshop.title as BilingualText;

  return NextResponse.json({
    valid: true,
    participantName: displayName(certificate.enrollment.user.name, 'Participant'),
    workshopTitle: { en: title.en, ja: title.ja },
    issuedAt: certificate.issuedAt.toISOString(),
  });
}
