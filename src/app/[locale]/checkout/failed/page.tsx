import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Chrome } from '@/components/Chrome';
import { TategakiLabel } from '@/components/TategakiLabel';

// Airwallex redirects here on a failed/abandoned payment (failUrl in
// beginCheckout). No charge was made; offer a single path back to the catalog.
export const dynamic = 'force-dynamic';

export default async function CheckoutFailedPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Checkout');

  return (
    <>
      <Chrome locale={locale} active="catalog" />
      <main className="screen">
        <section className="sec">
          <TategakiLabel>{t('failedTateLabel')}</TategakiLabel>
          <div className="sec-body">
            <div className="panel" style={{ maxWidth: 560 }}>
              <h1>{t('failedHeading')}</h1>
              <p className="sub" style={{ marginTop: 12 }}>
                {t('failedBody')}
              </p>
              <div style={{ marginTop: 16 }}>
                <Link href="/catalog" className="btn sec">
                  {t('backToCatalog')}
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
