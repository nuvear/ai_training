import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { redirect } from '@/i18n/navigation';
import { Chrome } from '@/components/Chrome';
import { TategakiLabel } from '@/components/TategakiLabel';
import { getSession } from '@/server/auth/session';
import { loadCheckoutContext } from '@/server/domain/checkout-read';
import { CheckoutForm } from '@/components/CheckoutForm';

// Buyer-specific, session-gated: always render fresh.
export const dynamic = 'force-dynamic';

export default async function CheckoutPage({
  params,
}: {
  params: Promise<{ locale: string; cohortId: string }>;
}) {
  const { locale, cohortId } = await params;
  setRequestLocale(locale);

  const session = await getSession();
  if (!session) {
    redirect({ href: '/signin', locale });
  }

  const ctx = await loadCheckoutContext(cohortId);
  if (!ctx) notFound();

  const t = await getTranslations('Checkout');
  const loc = locale === 'ja' ? 'ja' : 'en';
  const title = ctx.workshopTitle[loc] ?? ctx.workshopTitle.en ?? '';

  // JPY-first: JA locale (or a cohort with no USD price) purchases in yen.
  const currency: 'JPY' | 'USD' = loc === 'ja' || ctx.priceUsd == null ? 'JPY' : 'USD';
  const unitPrice = currency === 'JPY' ? ctx.priceJpy : ctx.priceUsd;
  if (unitPrice == null) notFound();

  return (
    <>
      <Chrome locale={locale} active="catalog" />
      <main className="screen">
        <section className="sec">
          <TategakiLabel>{t('tateLabel')}</TategakiLabel>
          <div className="sec-body">
            <h1>{t('heading')}</h1>
            <p className="sub">{t('subtitle')}</p>
            <CheckoutForm
              cohortId={ctx.cohortId}
              currency={currency}
              unitPrice={unitPrice}
              workshopTitle={title}
              startsAt={ctx.startsAt.toISOString()}
              endsAt={ctx.endsAt.toISOString()}
              locale={loc}
            />
          </div>
        </section>
      </main>
      <footer>WorkshopOS · {t('backToCatalog')}</footer>
    </>
  );
}
