import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Chrome } from '@/components/Chrome';
import { TategakiLabel } from '@/components/TategakiLabel';
import { requireSession } from '@/server/auth/rbac';
import { AuthError } from '@/server/auth/rbac';
import { withOrgContext, tenantContext } from '@/server/db/rls';
import { redirect, Link } from '@/i18n/navigation';
import { formatDate } from '@/lib/format';
import { CERT_SIGNATURE } from '@/server/pdf/certificate-pdf';

// Participant dashboard (calm register). Session-gated; render per request so
// auth is never statically cached.
export const dynamic = 'force-dynamic';

interface Bilingual {
  en?: string;
  ja?: string;
}

function pick(text: Bilingual | null | undefined, locale: 'en' | 'ja'): string {
  if (!text) return '';
  return text[locale] ?? text.en ?? text.ja ?? '';
}

export default async function ParticipantDashboard({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const loc = locale === 'ja' ? 'ja' : 'en';

  let session;
  try {
    session = await requireSession();
  } catch (err) {
    if (err instanceof AuthError) {
      redirect({ href: '/signin', locale });
    }
    throw err;
  }

  const t = await getTranslations('Participant');

  // Self-scoped read under RLS: this user's enrollments → cohort → workshop, with
  // this enrollment's attendance, quiz attempts, and certificate. The cohort's
  // sessions drive both the attendance denominator and the SESSIONS table.
  const enrollments = await withOrgContext(tenantContext(session!), async (tx) => {
    return tx.enrollment.findMany({
      where: { userId: session!.userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        cohort: {
          select: {
            workshop: { select: { title: true } },
            sessions: {
              orderBy: { seq: 'asc' },
              select: { id: true, seq: true, startsAt: true, agenda: true },
            },
          },
        },
        attendance: { select: { sessionId: true, status: true } },
        quizAttempts: {
          orderBy: { scorePct: 'desc' },
          select: { scorePct: true, passed: true, quiz: { select: { passPct: true } } },
        },
        certificate: { select: { verifyCode: true, issuedAt: true } },
      },
    });
  });

  const displayName =
    session!.name.given ||
    session!.name.display ||
    [session!.name.family, session!.name.given].filter(Boolean).join(' ') ||
    session!.email.split('@')[0] ||
    '';

  return (
    <>
      <Chrome locale={locale} active="me" />
      <main className="screen" style={{ maxWidth: 920 }}>
        {enrollments.length === 0 ? (
          <section className="sec">
            <TategakiLabel>{t('tateLearning')}</TategakiLabel>
            <div className="sec-body">
              <h1>{t('greeting', { name: displayName })}</h1>
              <p className="note" data-testid="me-empty">
                {t('emptyState')}
              </p>
              <div style={{ marginTop: 10 }}>
                <Link className="btn pri" href="/catalog">
                  {t('browseCatalog')}
                </Link>
              </div>
            </div>
          </section>
        ) : (
          (() => {
            // The first (most recent) enrollment drives the header KPIs; every
            // enrollment's sessions still render in the SESSIONS section below.
            const active = enrollments[0]!;
            const presentIds = new Set(
              active.attendance.filter((a) => a.status === 'present').map((a) => a.sessionId),
            );
            const totalSessions = active.cohort.sessions.length;
            const presentSessions = active.cohort.sessions.filter((s) =>
              presentIds.has(s.id),
            ).length;
            const attendancePct =
              totalSessions > 0 ? Math.round((presentSessions / totalSessions) * 100) : 0;

            const best = active.quizAttempts[0] ?? null;
            const passPct = best?.quiz.passPct ?? null;

            const cert = active.certificate;
            const workshopTitle = pick(active.cohort.workshop.title as Bilingual, loc);

            const statusLabel =
              active.status === 'completed' ? t('statusCompleted') : t('statusInProgress');

            return (
              <>
                {/* ── MY LEARNING ────────────────────────────────────────────── */}
                <section className="sec">
                  <TategakiLabel>{t('tateLearning')}</TategakiLabel>
                  <div className="sec-body">
                    <h1>{t('greeting', { name: displayName })}</h1>
                    <p className="sub">
                      {workshopTitle} · {statusLabel}
                    </p>
                    <div className="grid3">
                      <div className="panel">
                        <div className="kpi" data-testid="attendance-kpi">
                          {attendancePct}%<small>{t('kpiAttendance')}</small>
                        </div>
                        <div className="bar" style={{ marginTop: 10 }}>
                          <i style={{ width: `${attendancePct}%` }} />
                        </div>
                      </div>
                      <div className="panel">
                        <div className="kpi" data-testid="quiz-kpi">
                          {best ? `${best.scorePct}` : '—'}
                          <small>
                            {passPct !== null ? t('kpiQuiz', { pass: passPct }) : t('kpiQuizNone')}
                          </small>
                        </div>
                      </div>
                      <div className="panel" data-testid="cert-tile">
                        {cert ? (
                          <>
                            <div className="kpi" style={{ fontSize: 15 }}>
                              {t('certIssued')}
                              <small>{formatDate(cert.issuedAt, loc)}</small>
                            </div>
                            <p className="note" style={{ marginTop: 8 }}>
                              {CERT_SIGNATURE.en} / {CERT_SIGNATURE.ja}
                            </p>
                            <div className="row" style={{ marginTop: 10 }}>
                              <a
                                className="btn pri"
                                href={`/api/certificates/${active.id}/pdf?locale=${loc}`}
                                data-testid="cert-download"
                              >
                                {t('certDownload')}
                              </a>
                              <Link
                                className="btn sec"
                                href={`/verify/${cert.verifyCode}`}
                                data-testid="cert-verify-link"
                              >
                                {t('certVerify')}
                              </Link>
                            </div>
                          </>
                        ) : (
                          <div className="kpi" style={{ fontSize: 15 }}>
                            {t('certPending')}
                            <small>{t('certPendingNote')}</small>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </section>

                {/* ── SESSIONS ───────────────────────────────────────────────── */}
                <section className="sec">
                  <TategakiLabel>{t('tateSessions')}</TategakiLabel>
                  <div className="sec-body panel">
                    <h2>{t('sessionsHeading')}</h2>
                    <table>
                      <tbody>
                        {active.cohort.sessions.map((s) => {
                          const attended = presentIds.has(s.id);
                          const title =
                            pick(s.agenda as Bilingual, loc) || t('sessionSeq', { seq: s.seq });
                          return (
                            <tr key={s.id} data-testid="session-row">
                              <td>{title}</td>
                              <td className="mono">{formatDate(s.startsAt, loc)}</td>
                              <td>
                                {attended ? (
                                  <span className="badge ok">{t('attended')}</span>
                                ) : (
                                  <span className="badge auto">{t('upcoming')}</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <p className="note" style={{ marginTop: 10 }}>
                      {t('preworkNote')}
                    </p>
                    <div style={{ marginTop: 10 }}>
                      <Link className="btn pri" href="/help">
                        {t('preworkAction')}
                      </Link>
                    </div>
                  </div>
                </section>
              </>
            );
          })()
        )}
      </main>
    </>
  );
}
