import { setRequestLocale } from 'next-intl/server';
import { CheckoutComplete } from '../complete/CheckoutComplete';

// The URL beginCheckout registers as Airwallex's successUrl
// (/checkout/success?order=…). Renders the same confirmation as /complete.
export const dynamic = 'force-dynamic';

export default async function CheckoutSuccessPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ order?: string; orderId?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  return <CheckoutComplete locale={locale} orderId={sp.order ?? sp.orderId} />;
}
