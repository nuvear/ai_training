'use client';

import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';

// Swaps the locale segment while preserving the current path + params, so the
// switch never loses page state (DESIGN §10 / tasks M0 §4).
export function LocaleSwitcher({ current }: { current: string }) {
  const t = useTranslations('Chrome');
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams();

  function switchTo(locale: string) {
    if (locale === current) return;
    // pathname here is locale-agnostic (next-intl strips the prefix); pass the
    // target locale so the same route renders in the other language.
    router.replace(
      // @ts-expect-error — dynamic params are passed through unchanged
      { pathname, params },
      { locale },
    );
  }

  return (
    <div className="lang" role="group" aria-label={t('localeLabel')}>
      {routing.locales.map((locale) => (
        <button
          key={locale}
          type="button"
          className={locale === current ? 'on' : ''}
          aria-pressed={locale === current}
          onClick={() => switchTo(locale)}
        >
          {locale === 'ja' ? '日本語' : 'EN'}
        </button>
      ))}
    </div>
  );
}
