import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Chrome } from '@/components/Chrome';
import { TategakiLabel } from '@/components/TategakiLabel';
import { ApprovalQueue } from '@/components/ApprovalQueue';
import { getSession } from '@/server/auth/session';
import { STAFF_ROLES } from '@/server/auth/rbac';
import { redirect } from '@/i18n/navigation';

// Session-gated: render per-request so auth is never statically cached.
export const dynamic = 'force-dynamic';

export default async function ApprovalsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await getSession();
  if (!session || !STAFF_ROLES.includes(session.role)) {
    redirect({ href: '/signin', locale });
  }

  const t = await getTranslations('Approvals');

  return (
    <>
      <Chrome locale={locale} active="approvals" />
      <main className="screen">
        <section className="sec">
          <TategakiLabel>{t('tateLabel')}</TategakiLabel>
          <div className="sec-body">
            <h1>{t('heading')}</h1>
            <p className="sub">{t('subtitle')}</p>
            <ApprovalQueue />
          </div>
        </section>
      </main>
    </>
  );
}
