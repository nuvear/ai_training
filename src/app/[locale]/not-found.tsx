import { useTranslations } from 'next-intl';

// Locale-scoped 404 (renders inside the [locale] layout, so it has html + chrome
// tokens). Unmatched non-locale paths fall through to app/not-found.tsx.
export default function LocaleNotFound() {
  const t = useTranslations('Common');
  return (
    <main className="screen">
      <section className="sec">
        <div className="tate">404</div>
        <div className="sec-body">
          <h1>404</h1>
          <p className="sub">{t('error')}</p>
        </div>
      </section>
    </main>
  );
}
