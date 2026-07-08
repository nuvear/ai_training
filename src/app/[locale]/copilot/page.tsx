import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Chrome } from '@/components/Chrome';
import { TategakiLabel } from '@/components/TategakiLabel';
import { CopilotConsole } from '@/components/CopilotConsole';
import { ApprovalQueue } from '@/components/ApprovalQueue';
import { TierBadge } from '@/components/TierBadge';
import { getSession } from '@/server/auth/session';
import { STAFF_ROLES } from '@/server/auth/rbac';
import { redirect } from '@/i18n/navigation';
import { prisma } from '@/server/db/client';
import { formatJpy } from '@/lib/format';

// Session-gated: render per-request so auth is never statically cached and the
// approval count / ledger reflect live state.
export const dynamic = 'force-dynamic';

function startOfWeek(now: Date): Date {
  const d = new Date(now);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day);
  return d;
}

export default async function CopilotPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await getSession();
  if (!session || !STAFF_ROLES.includes(session.role)) {
    redirect({ href: '/signin', locale });
  }

  const t = await getTranslations('Copilot');
  const tTier = await getTranslations('Tier');
  const tApprovals = await getTranslations('Approvals');
  const firstName =
    session!.name.given || session!.name.display || session!.email.split('@')[0] || 'there';

  const weekStart = startOfWeek(new Date());

  // Live numbers for the header — kept simple and real.
  const [pendingCount, weekOrders, newEnrollments, runningCohorts, ledger] = await Promise.all([
    prisma.aiAction.count({ where: { status: 'proposed', toolName: { not: 'copilot.plan' } } }),
    prisma.order.findMany({
      where: { status: 'paid', currency: 'JPY', createdAt: { gte: weekStart } },
      select: { total: true },
    }),
    prisma.enrollment.count({ where: { createdAt: { gte: weekStart } } }),
    prisma.cohort.count({ where: { status: 'running' } }),
    prisma.aiAction.findMany({
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: { id: true, toolName: true, tier: true, status: true },
    }),
  ]);

  const salesJpy = weekOrders.reduce((sum, o) => sum + o.total, 0);

  return (
    <>
      <Chrome locale={locale} active="copilot" />
      <main className="screen">
        <section className="sec">
          <TategakiLabel>{t('tateLabel')}</TategakiLabel>
          <div className="sec-body">
            <h1>{t('statsHeading', { name: firstName, count: pendingCount })}</h1>
            <p className="sub">
              {t('statsLine', {
                sales: formatJpy(salesJpy, locale),
                enrollments: newEnrollments,
                cohorts: runningCohorts,
              })}
            </p>
            <CopilotConsole firstName={firstName} />
          </div>
        </section>

        <section className="sec">
          <TategakiLabel>APPROVALS</TategakiLabel>
          <div className="sec-body grid2">
            <div className="panel">
              <h2>{tApprovals('heading')}</h2>
              <ApprovalQueue />
            </div>
            <div className="panel">
              <h2>{t('ledgerHeading')}</h2>
              {ledger.length === 0 ? (
                <p className="note">{t('ledgerEmpty')}</p>
              ) : (
                <table>
                  <tbody>
                    {ledger.map((row) => (
                      <tr key={row.id} data-testid="ledger-row">
                        <td>
                          <span className="mono">{row.toolName}</span>
                          <div className="note mono">{row.id.slice(0, 8)}</div>
                        </td>
                        <td>
                          <TierBadge tier={row.tier} label={tTier(row.tier)} />
                        </td>
                        <td className="note">{row.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
