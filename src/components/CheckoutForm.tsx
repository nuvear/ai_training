'use client';

import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { formatJpy, formatUsd, formatDate } from '@/lib/format';

type Currency = 'JPY' | 'USD';
type Method = 'card' | 'konbini' | 'bank_transfer';

interface Quote {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  currency: Currency;
  promoError?: string;
}

interface Props {
  cohortId: string;
  currency: Currency;
  unitPrice: number;
  workshopTitle: string;
  /** ISO strings — Dates don't cross the server/client boundary cleanly. */
  startsAt: string;
  endsAt: string;
  locale: 'en' | 'ja';
}

function money(amount: number, currency: Currency, locale: 'en' | 'ja'): string {
  return currency === 'JPY' ? formatJpy(amount, locale) : formatUsd(amount);
}

export function CheckoutForm({
  cohortId,
  currency,
  unitPrice,
  workshopTitle,
  startsAt,
  endsAt,
  locale,
}: Props) {
  const t = useTranslations('Checkout');

  const [method, setMethod] = useState<Method>('card');
  const [promoInput, setPromoInput] = useState('');
  // The code that is actually applied to the authoritative quote.
  const [appliedPromo, setAppliedPromo] = useState<string | undefined>(undefined);
  const [quote, setQuote] = useState<Quote>({
    subtotal: unitPrice,
    discount: 0,
    tax: currency === 'JPY' ? Math.round(unitPrice * 0.1) : 0,
    total: currency === 'JPY' ? unitPrice + Math.round(unitPrice * 0.1) : unitPrice,
    currency,
  });
  const [quoting, setQuoting] = useState(false);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState(false);

  // Fetch the authoritative quote from the server (never compute money here).
  const refreshQuote = useCallback(
    async (promoCode?: string) => {
      setQuoting(true);
      try {
        const res = await fetch('/api/checkout/quote', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ cohortId, currency, promoCode }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as Quote;
        setQuote(data);
      } finally {
        setQuoting(false);
      }
    },
    [cohortId, currency],
  );

  // Load the server-authoritative quote on mount (tax line, etc.).
  useEffect(() => {
    void refreshQuote(undefined);
  }, [refreshQuote]);

  function applyPromo(e: React.FormEvent) {
    e.preventDefault();
    const code = promoInput.trim() || undefined;
    setAppliedPromo(code);
    void refreshQuote(code);
  }

  async function pay() {
    setPaying(true);
    setPayError(false);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cohortId, currency, method, promoCode: appliedPromo }),
      });
      if (!res.ok) throw new Error('checkout failed');
      const data = (await res.json()) as { checkoutUrl: string };
      window.location.href = data.checkoutUrl;
    } catch {
      setPayError(true);
      setPaying(false);
    }
  }

  const promoErrorKey = quote.promoError ? `promo_${quote.promoError}` : null;

  return (
    <div className="grid2" data-testid="checkout-form">
      {/* Left: payment method */}
      <div>
        <h2 style={{ fontSize: 20 }}>{workshopTitle}</h2>
        <p className="sub">
          {t('dateRange', {
            start: formatDate(new Date(startsAt), locale),
            end: formatDate(new Date(endsAt), locale),
          })}
        </p>

        <div className="field">
          <label>{t('paymentMethod')}</label>
          <div className="pay">
            <label>
              <input
                type="radio"
                name="pm"
                data-testid="pm-card"
                checked={method === 'card'}
                onChange={() => setMethod('card')}
              />
              {t('methodCard')}
            </label>
            <label>
              <input
                type="radio"
                name="pm"
                data-testid="pm-konbini"
                checked={method === 'konbini'}
                onChange={() => setMethod('konbini')}
              />
              {t('methodKonbini')}
            </label>
            <label>
              <input
                type="radio"
                name="pm"
                data-testid="pm-bank"
                checked={method === 'bank_transfer'}
                onChange={() => setMethod('bank_transfer')}
              />
              {t('methodBank')}
            </label>
          </div>
          <p className="note">{t('cardNote')}</p>
        </div>
      </div>

      {/* Right: order summary */}
      <div className="panel">
        <h2>{t('orderSummary')}</h2>
        <table>
          <tbody>
            <tr>
              <td>{workshopTitle}</td>
              <td className="num">{money(quote.subtotal, currency, locale)}</td>
            </tr>
            {quote.discount > 0 && (
              <tr>
                <td>{t('discountLine')}</td>
                <td className="num" style={{ color: 'var(--matsu)' }}>
                  −{money(quote.discount, currency, locale)}
                </td>
              </tr>
            )}
            {currency === 'JPY' && (
              <tr>
                <td>{t('taxLine')}</td>
                <td className="num">{money(quote.tax, currency, locale)}</td>
              </tr>
            )}
            <tr className="total">
              <td>{t('totalLine')}</td>
              <td className="num" data-testid="order-total">
                {money(quote.total, currency, locale)}
              </td>
            </tr>
          </tbody>
        </table>

        <form onSubmit={applyPromo} className="row" style={{ marginTop: 14, gap: 8 }}>
          <input
            aria-label={t('promoLabel')}
            placeholder={t('promoPlaceholder')}
            value={promoInput}
            onChange={(e) => setPromoInput(e.target.value)}
            data-testid="promo-input"
            style={{
              flex: 1,
              border: '1px solid var(--line-strong)',
              borderRadius: 6,
              padding: '9px 12px',
              font: 'inherit',
              background: 'var(--surface)',
            }}
          />
          <button type="submit" className="btn sec" disabled={quoting} data-testid="apply-promo">
            {t('applyPromo')}
          </button>
        </form>
        {promoErrorKey && (
          <p className="error" style={{ marginTop: 8 }} data-testid="promo-error">
            {t(promoErrorKey)}
          </p>
        )}
        {appliedPromo && !quote.promoError && quote.discount > 0 && (
          <p className="note" style={{ marginTop: 8, color: 'var(--matsu)' }}>
            {t('promoApplied')}
          </p>
        )}

        <button
          type="button"
          className="btn pri"
          style={{ width: '100%', marginTop: 14 }}
          onClick={pay}
          disabled={paying}
          data-testid="pay-button"
        >
          {paying ? t('paying') : t('pay')}
        </button>

        {payError && (
          <p className="error" style={{ marginTop: 10 }} data-testid="pay-error">
            {t('payError')}
          </p>
        )}

        <p className="note" style={{ marginTop: 10 }}>
          {t('refundNote')}
        </p>
      </div>
    </div>
  );
}
