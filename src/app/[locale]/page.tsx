import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Chrome } from '@/components/Chrome';
import { TategakiLabel } from '@/components/TategakiLabel';
import { getSession } from '@/server/auth/session';
import { Link } from '@/i18n/navigation';

// The line-height token per locale — mirrors --lh in globals.css (§4). Rendered
// so the bilingual typesetting is visible (and assertable) at a glance.
const LINE_HEIGHT: Record<string, string> = { en: '1.7', ja: '1.8' };

// Reads the session cookie, so it renders per-request (never a cached auth state).
export const dynamic = 'force-dynamic';

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Home');
  const tAuth = await getTranslations('Auth');
  const session = await getSession();

  return (
    <>
      <Chrome locale={locale} active="home" />
      <main className="screen">
        <section className="sec">
          <TategakiLabel>{t('tateLabel')}</TategakiLabel>
          <div className="sec-body">
            <h1>{t('title')}</h1>
            <p className="sub">{t('subtitle')}</p>
            {session ? (
              <p className="note" data-testid="signed-in">
                {tAuth('signedInAs', { email: session.email })}
              </p>
            ) : (
              <p className="row">
                <Link href="/signin" className="btn pri" data-testid="home-signin">
                  {tAuth('heading')}
                </Link>
                <span className="note">{t('signInPrompt')}</span>
              </p>
            )}
          </div>
        </section>

        <section className="sec">
          <TategakiLabel>{t('typographyTateLabel')}</TategakiLabel>
          <div className="sec-body">
            <h2>{t('typographyHeading')}</h2>
            <div className="row" style={{ marginBottom: 16 }}>
              <span className="note">{t('localeLabel')}:</span>
              <span className="mono" data-testid="active-locale">
                {locale}
              </span>
              <span className="note">{t('lineHeightLabel')}:</span>
              <span className="mono" data-testid="line-height-token">
                {LINE_HEIGHT[locale] ?? '1.7'}
              </span>
            </div>
            <p data-testid="sample-body" style={{ maxWidth: '52ch' }}>
              {t('sampleBody')}
            </p>
          </div>
        </section>
      </main>
      <footer>{t('byline')}</footer>
    </>
  );
}
