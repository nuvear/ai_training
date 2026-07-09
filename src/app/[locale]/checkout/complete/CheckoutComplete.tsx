import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Chrome } from '@/components/Chrome';
import { TategakiLabel } from '@/components/TategakiLabel';
import { loadOrderConfirmation } from '@/server/domain/order-read';

// Shared post-payment confirmation. Airwallex redirects to /checkout/success
// (the URL beginCheckout registers); /checkout/complete is the task-named alias.
// Both render this. The order id arrives as ?order= (backend) or ?orderId=.
export async function CheckoutComplete({ locale, orderId }: { locale: string; orderId?: string }) {
  const t = await getTranslations('Checkout');
  const confirmation = orderId ? await loadOrderConfirmation(orderId) : null;

  return (
    <>
      <Chrome locale={locale} active="catalog" />
      <main className="screen">
        <section className="sec">
          <TategakiLabel>{t('completeTateLabel')}</TategakiLabel>
          <div className="sec-body">
            <div className="panel" style={{ maxWidth: 560 }}>
              <h1>{t('completeHeading')}</h1>
              <p className="sub" style={{ marginTop: 12 }}>
                {confirmation?.isKonbini ? t('completeKonbini') : t('completeBody')}
              </p>
              {orderId && (
                <p className="note">
                  {t('viewOrder')} <span className="mono">{orderId}</span>
                </p>
              )}
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
