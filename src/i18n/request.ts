import { getRequestConfig } from 'next-intl/server';
import { routing, isAppLocale } from './routing';

// Loads the message catalog for the active request locale. Falls back to the
// default locale for unknown segments.
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = isAppLocale(requested) ? requested : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
