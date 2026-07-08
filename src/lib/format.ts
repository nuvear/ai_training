// Money + date formatting per DESIGN §7/§8. Numerals are always Latin (no
// full-width digits), even in JA. JPY has no decimals; USD is stored in cents.

export function formatJpy(yen: number, locale: string): string {
  return '¥' + yen.toLocaleString(locale === 'ja' ? 'ja-JP' : 'en-US');
}

export function formatUsd(cents: number): string {
  return (
    '$' +
    (cents / 100).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

export function formatDate(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}
