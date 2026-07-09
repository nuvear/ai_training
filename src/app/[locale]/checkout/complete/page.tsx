import { setRequestLocale } from 'next-intl/server';
import { CheckoutComplete } from './CheckoutComplete';

export const dynamic = 'force-dynamic';

export default async function CheckoutCompletePage({
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
