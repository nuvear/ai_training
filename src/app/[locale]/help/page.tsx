import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Chrome } from '@/components/Chrome';
import { TategakiLabel } from '@/components/TategakiLabel';
import { ConciergeChat } from '@/components/ConciergeChat';

// PUBLIC concierge help page (no auth). The concierge always self-identifies as
// an AI assistant and uses only the restricted §7 tool subset (enforced server-
// side in /api/concierge).
export const dynamic = 'force-dynamic';

export default async function HelpPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Concierge');

  return (
    <>
      <Chrome locale={locale} active="home" />
      <main className="screen" style={{ maxWidth: 720 }}>
        <section className="sec">
          <TategakiLabel>{t('tateLabel')}</TategakiLabel>
          <div className="sec-body">
            <h1>{t('heading')}</h1>
            <p className="sub">{t('subtitle')}</p>
            <ConciergeChat />
          </div>
        </section>
      </main>
    </>
  );
}
