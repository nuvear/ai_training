'use client';

import { useTranslations } from 'next-intl';

// Per-locale localization status chip (DESIGN §7 tint contract):
//  human_reviewed → ok (松葉) · ai_localized → approve (黄金鈍) · missing → muted note.
// State is data, never a color name — the caller passes the raw review value.
export function LocalizationChip({ locale, state }: { locale: 'en' | 'ja'; state?: string }) {
  const t = useTranslations('Admin');
  const localeLabel = locale === 'en' ? t('localeEn') : t('localeJa');

  if (state === 'human_reviewed') {
    return (
      <span className="badge ok" data-testid={`loc-chip-${locale}`} data-state="human_reviewed">
        {localeLabel} · {t('loc_human_reviewed')}
      </span>
    );
  }
  if (state === 'ai_localized') {
    return (
      <span className="badge approve" data-testid={`loc-chip-${locale}`} data-state="ai_localized">
        {localeLabel} · {t('loc_ai_localized')}
      </span>
    );
  }
  return (
    <span className="note" data-testid={`loc-chip-${locale}`} data-state="missing">
      {localeLabel} · {t('loc_missing')}
    </span>
  );
}
