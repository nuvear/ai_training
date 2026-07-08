import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Chrome } from '@/components/Chrome';
import { TategakiLabel } from '@/components/TategakiLabel';
import { OrgInviteEmployees } from '@/components/OrgInviteEmployees';
import { requireOrgAccess } from '@/server/auth/org-access';
import { AuthError } from '@/server/auth/rbac';
import { readOrgProgress } from '@/server/domain/org-progress';
import { withOrgContext, tenantContext } from '@/server/db/rls';
import { redirect } from '@/i18n/navigation';
import { formatJpy, formatDate } from '@/lib/format';
import type { EmployeeProgress } from '@/server/domain/org-progress';

// Session-gated org portal (calm register). Render per request so auth is never
// statically cached.
export const dynamic = 'force-dynamic';

interface Bilingual {
  en?: string;
  ja?: string;
}

function pick(text: Bilingual | null | undefined, locale: 'en' | 'ja'): string {
  if (!text) return '';
  return text[locale] ?? text.en ?? text.ja ?? '';
}

function employeeName(e: EmployeeProgress, fallback: string): string {
  const n = e.name;
  if (n.display?.trim()) return n.display;
  const composed = [n.family, n.given].filter(Boolean).join(' ').trim();
  if (composed) return composed;
  return e.email || fallback;
}

// An employee has "completed" when every enrollment is completed and there is at
// least one (mirrors the mock's done/in-progress split from enrollment status).
function isCompleted(e: EmployeeProgress): boolean {
  return e.statuses.length > 0 && e.statuses.every((s) => s === 'completed');
}

export default async function OrgPortalPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const loc = locale === 'ja' ? 'ja' : 'en';

  let session;
  try {
    session = await requireOrgAccess(id);
  } catch (err) {
    if (err instanceof AuthError) {
      redirect({ href: '/signin', locale });
    }
    throw err;
  }

  const t = await getTranslations('OrgPortal');

  // KPIs + per-employee progress via the sanctioned, self-scoped, privacy-gated
  // reader (owner-elevated inside; never selects free-text reflections).
  const progress = await readOrgProgress(id);

  // Org name, active seat pool (for the valid-through date + assign target), and
  // invoices with their order total (tax-incl amount). RLS re-scopes these to the
  // caller's org for org_admins; owner/staff read globally.
  const { org, activePool, invoices } = await withOrgContext(tenantContext(session), async (tx) => {
    const org = await tx.organization.findUnique({ where: { id }, select: { name: true } });
    const seatPools = await tx.seatPool.findMany({
      where: { organizationId: id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, validUntil: true },
    });
    const activePool = seatPools.find((p) => p.status === 'active') ?? seatPools[0] ?? null;
    const invoiceRows = await tx.invoice.findMany({
      where: { organizationId: id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        number: true,
        dueAt: true,
        status: true,
        order: { select: { total: true, currency: true } },
      },
    });
    return { org, activePool, invoices: invoiceRows };
  });

  const orgName = pick(org?.name as Bilingual | null, loc);
  const seatPct =
    progress.seatsTotal > 0 ? Math.round((progress.seatsUsed / progress.seatsTotal) * 100) : 0;
  const subtitle = activePool
    ? t('seatPoolSubtitle', { date: formatDate(activePool.validUntil, loc) })
    : t('seatPoolSubtitleNoDate');

  return (
    <>
      <Chrome locale={locale} active="org" />
      <main className="screen">
        {/* ── ORG PORTAL ─────────────────────────────────────────────────── */}
        <section className="sec">
          <TategakiLabel>{t('tatePortal')}</TategakiLabel>
          <div className="sec-body">
            <h1>{orgName}</h1>
            <p className="sub">{subtitle}</p>
            <div className="grid3">
              <div className="panel">
                <div className="kpi" data-testid="seats-kpi">
                  {progress.seatsUsed} / {progress.seatsTotal}
                  <small>{t('kpiSeatsUsed')}</small>
                </div>
                <div className="bar" style={{ marginTop: 10 }}>
                  <i style={{ width: `${seatPct}%` }} />
                </div>
              </div>
              <div className="panel">
                <div className="kpi">
                  {progress.completions}
                  <small>{t('kpiCompletions')}</small>
                </div>
              </div>
              <div className="panel">
                <div className="kpi">
                  {progress.avgRating ?? '—'}
                  <small>
                    {t('kpiAvgRating')}
                    {progress.avgRating === null && (
                      <span className="note mono" style={{ marginLeft: 6 }}>
                        {t('m4Note')}
                      </span>
                    )}
                  </small>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── PROGRESS ───────────────────────────────────────────────────── */}
        <section className="sec">
          <TategakiLabel>{t('tateProgress')}</TategakiLabel>
          <div className="sec-body panel">
            <h2>{t('progressHeading')}</h2>
            {progress.employees.length === 0 ? (
              <p className="note">{t('noEmployees')}</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>{t('colName')}</th>
                    <th>{t('colWorkshop')}</th>
                    <th>{t('colAttendance')}</th>
                    <th>{t('colQuiz')}</th>
                    <th>{t('colStatus')}</th>
                  </tr>
                </thead>
                <tbody>
                  {progress.employees.map((e) => {
                    const done = isCompleted(e);
                    const workshops =
                      e.enrolledWorkshops.length > 0
                        ? e.enrolledWorkshops.join('、')
                        : t('noWorkshops');
                    return (
                      <tr key={e.userId} data-testid="employee-row">
                        <td>{employeeName(e, t('unnamedEmployee'))}</td>
                        <td>{workshops}</td>
                        <td className="mono">
                          {t('noWorkshops')} <span className="note mono">{t('m4Note')}</span>
                        </td>
                        <td className="mono">
                          {t('noWorkshops')} <span className="note mono">{t('m4Note')}</span>
                        </td>
                        <td>
                          {done ? (
                            <span className="badge ok">{t('statusCompleted')}</span>
                          ) : (
                            <span className="badge approve">{t('statusInProgress')}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <p className="note" style={{ marginTop: 10 }}>
              {t('reportNote')}
            </p>
            <div className="row" style={{ marginTop: 'var(--sp-1)' }}>
              <a
                className="btn sec"
                href={`/api/org/${id}/report.pdf?locale=${loc}`}
                data-testid="report-pdf-link"
              >
                {t('downloadReport')}
              </a>
            </div>

            <OrgInviteEmployees seatPoolId={activePool?.id ?? null} />
          </div>
        </section>

        {/* ── BILLING ────────────────────────────────────────────────────── */}
        <section className="sec">
          <TategakiLabel>{t('tateBilling')}</TategakiLabel>
          <div className="sec-body panel">
            <h2>{t('invoicesHeading')}</h2>
            {invoices.length === 0 ? (
              <p className="note">{t('noInvoices')}</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>{t('colInvoiceNo')}</th>
                    <th>{t('colAmount')}</th>
                    <th>{t('colDue')}</th>
                    <th>{t('colInvoiceStatus')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id} data-testid="invoice-row">
                      <td className="mono">{inv.number}</td>
                      <td className="num">{formatJpy(inv.order.total, loc)}</td>
                      <td className="mono">{formatDate(inv.dueAt, loc)}</td>
                      <td>
                        {inv.status === 'paid' ? (
                          <span className="badge ok">{t('statusPaid')}</span>
                        ) : (
                          <span className="badge approve">{t('statusIssued')}</span>
                        )}
                      </td>
                      <td>
                        <a
                          className="btn sec"
                          href={`/api/invoices/${inv.id}/pdf`}
                          data-testid="invoice-pdf-link"
                        >
                          {t('invoicePdf')}
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </main>
    </>
  );
}
