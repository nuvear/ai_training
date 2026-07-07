import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Chrome } from '@/components/Chrome';
import { TategakiLabel } from '@/components/TategakiLabel';
import { CopilotConsole } from '@/components/CopilotConsole';
import { getSession } from '@/server/auth/session';
import { STAFF_ROLES } from '@/server/auth/rbac';
import { redirect } from '@/i18n/navigation';

// Session-gated: render per-request so auth is never statically cached.
export const dynamic = 'force-dynamic';

export default async function CopilotPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await getSession();
  if (!session || !STAFF_ROLES.includes(session.role)) {
    redirect({ href: '/signin', locale });
  }

  const t = await getTranslations('Copilot');
  const firstName =
    session!.name.given || session!.name.display || session!.email.split('@')[0] || 'there';

  return (
    <>
      <Chrome locale={locale} active="copilot" />
      <main className="screen">
        <section className="sec">
          <TategakiLabel>{t('tateLabel')}</TategakiLabel>
          <div className="sec-body">
            <h1>{t('heading')}</h1>
            <p className="sub">{t('subtitle')}</p>
            <CopilotConsole firstName={firstName} />
          </div>
        </section>
      </main>
    </>
  );
}
