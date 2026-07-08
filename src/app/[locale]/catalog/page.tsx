import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Chrome } from '@/components/Chrome';
import { TategakiLabel } from '@/components/TategakiLabel';
import { Link } from '@/i18n/navigation';
import { listPublishedWorkshops } from '@/server/domain/catalog';
import { formatJpy, formatUsd, formatDate } from '@/lib/format';

// Public catalog reads live published data.
export const dynamic = 'force-dynamic';

type Bilingual = { en?: string; ja?: string };

export default async function CatalogPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Catalog');
  const tc = await getTranslations('Checkout');
  const loc = locale === 'ja' ? 'ja' : 'en';

  const workshops = await listPublishedWorkshops();

  return (
    <>
      <Chrome locale={locale} active="catalog" />
      <main className="screen">
        <section className="sec">
          <TategakiLabel>{t('tateLabel')}</TategakiLabel>
          <div className="sec-body">
            <h1>{t('heading')}</h1>
            <p className="sub">{t('subtitle')}</p>

            {workshops.length === 0 ? (
              <p className="note" data-testid="catalog-empty">
                {t('empty')}
              </p>
            ) : (
              <div className="grid3" data-testid="catalog-grid">
                {workshops.map((w) => {
                  const title = (w.title as Bilingual)[loc] ?? (w.title as Bilingual).en ?? w.slug;
                  const summary =
                    (w.summary as Bilingual)[loc] ?? (w.summary as Bilingual).en ?? '';
                  const cohort = w.cohorts[0];
                  const price =
                    cohort == null
                      ? null
                      : loc === 'ja' || cohort.priceUsd == null
                        ? cohort.priceJpy != null
                          ? formatJpy(cohort.priceJpy, loc)
                          : null
                        : formatUsd(cohort.priceUsd);
                  return (
                    <article
                      className="card"
                      key={w.id}
                      data-testid="catalog-card"
                      data-slug={w.slug}
                    >
                      <div className="thumb">{title}</div>
                      <div className="body">
                        <div className="meta">{t(`level_${w.level}`)}</div>
                        <div className="meta" style={{ color: 'var(--ai-700)' }}>
                          {t('ledBy')}
                          {t('facilitator')}
                        </div>
                        <div data-testid="card-title">{summary}</div>
                        <div>
                          {w.skills.map((ws) => (
                            <span className="skill" key={ws.skillId}>
                              {(ws.skill.name as Bilingual)[loc] ?? (ws.skill.name as Bilingual).en}
                            </span>
                          ))}
                        </div>
                        {(price || cohort) && (
                          <div className="row" style={{ justifyContent: 'space-between' }}>
                            {price && <span className="price">{price}</span>}
                            {cohort && (
                              <span className="meta">
                                {t('starts')} {formatDate(cohort.startsAt, loc)}
                              </span>
                            )}
                          </div>
                        )}
                        {cohort && price && (
                          <Link
                            href={`/checkout/${cohort.id}`}
                            className="btn pri"
                            data-testid="enroll-button"
                            style={{ marginTop: 4 }}
                          >
                            {tc('enroll')}
                          </Link>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </main>
      <footer>WorkshopOS · {t('facilitator')}</footer>
    </>
  );
}
