import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Chrome } from '@/components/Chrome';
import { TategakiLabel } from '@/components/TategakiLabel';
import { AdminWorkshopEditor } from '@/components/AdminWorkshopEditor';
import { getSession } from '@/server/auth/session';
import { STAFF_ROLES } from '@/server/auth/rbac';
import { redirect } from '@/i18n/navigation';

export const dynamic = 'force-dynamic';

export default async function NewWorkshopPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await getSession();
  if (!session || !STAFF_ROLES.includes(session.role)) {
    redirect({ href: '/signin', locale });
  }

  const t = await getTranslations('Admin');

  return (
    <>
      <Chrome locale={locale} active="admin" />
      <main className="screen">
        <section className="sec">
          <TategakiLabel>{t('tateLabel')}</TategakiLabel>
          <div className="sec-body">
            <h1>{t('editHeadingNew')}</h1>
            <p className="sub">{t('editSubtitle')}</p>
            <AdminWorkshopEditor />
          </div>
        </section>
      </main>
    </>
  );
}
