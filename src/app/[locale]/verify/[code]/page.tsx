import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Chrome } from '@/components/Chrome';
import { TategakiLabel } from '@/components/TategakiLabel';
import { prisma } from '@/server/db/client';
import { formatDate } from '@/lib/format';
import type { BilingualText } from '@/server/ai/i18n-content';

// PUBLIC certificate verification (no auth). Reads a certificate by its verifyCode
// and shows only the participant's display name, workshop title, and issue date —
// never PII beyond the name (mirrors GET /api/verify/[code]). An unknown code
// renders a calm "could not be verified" message.
export const dynamic = 'force-dynamic';

function displayName(name: unknown, fallback: string): string {
  const n = (name ?? {}) as { display?: string; given?: string; family?: string };
  if (n.display?.trim()) return n.display.trim();
  const parts = [n.family, n.given].filter((p): p is string => Boolean(p?.trim()));
  if (parts.length) return parts.join(' ');
  return fallback;
}

export default async function VerifyCertificatePage({
  params,
}: {
  params: Promise<{ locale: string; code: string }>;
}) {
  const { locale, code } = await params;
  setRequestLocale(locale);
  const loc = locale === 'ja' ? 'ja' : 'en';
  const t = await getTranslations('Verify');

  // Read directly by verifyCode (certificate RLS allows the owner connection) and
  // select only the fields the public verification is allowed to disclose.
  const certificate = await prisma.certificate.findUnique({
    where: { verifyCode: code },
    select: {
      issuedAt: true,
      enrollment: {
        select: {
          user: { select: { name: true } },
          cohort: { select: { workshop: { select: { title: true } } } },
        },
      },
    },
  });

  const valid = Boolean(certificate);
  const title = certificate
    ? ((certificate.enrollment.cohort.workshop.title as BilingualText)[loc] ??
      (certificate.enrollment.cohort.workshop.title as BilingualText).en ??
      '')
    : '';
  const name = certificate
    ? displayName(certificate.enrollment.user.name, t('participantFallback'))
    : '';

  return (
    <>
      <Chrome locale={locale} active="home" />
      <main className="screen" style={{ maxWidth: 640 }}>
        <section className="sec">
          <TategakiLabel>{t('tateLabel')}</TategakiLabel>
          <div className="sec-body">
            <h1>{t('heading')}</h1>
            {valid ? (
              <div className="panel" data-testid="verify-result">
                <div style={{ marginBottom: 12 }}>
                  <span className="badge ok" data-testid="verify-valid">
                    {t('verified')}
                  </span>
                </div>
                <p className="sub" style={{ marginTop: 0 }}>
                  {t('confirms', { name, workshop: title })}
                </p>
                <table>
                  <tbody>
                    <tr>
                      <td>{t('labelName')}</td>
                      <td>{name}</td>
                    </tr>
                    <tr>
                      <td>{t('labelWorkshop')}</td>
                      <td>{title}</td>
                    </tr>
                    <tr>
                      <td>{t('labelIssued')}</td>
                      <td className="mono">{formatDate(certificate!.issuedAt, loc)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="note" data-testid="verify-result">
                {t('notFound')}
              </p>
            )}
          </div>
        </section>
      </main>
    </>
  );
}
