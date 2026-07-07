import { defineRouting } from 'next-intl/routing';

// Locale lives in the URL path: /en/… and /ja/…. JA is the primary market, but
// we default routing to EN and let the switcher swap the segment. Both are
// always available; content entities always carry both (CLAUDE.md invariant 1).
export const routing = defineRouting({
  locales: ['en', 'ja'],
  defaultLocale: 'en',
  localePrefix: 'always',
});

export type AppLocale = (typeof routing.locales)[number];

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === 'string' && (routing.locales as readonly string[]).includes(value);
}
