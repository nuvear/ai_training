'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { formatJpy, formatUsd, formatDate } from '@/lib/format';

type Format = 'online' | 'in_person' | 'hybrid';

interface Cohort {
  id: string;
  status: 'open' | 'full' | 'running' | 'completed' | 'cancelled';
  startsAt: string;
  endsAt: string;
  capacity: number;
  priceJpy: number | null;
  priceUsd: number | null;
  format: Format;
}

interface ExecResult {
  status?: string;
  requiresApproval?: boolean;
  error?: string;
}

// Cohort status → tint (DESIGN §7): open/running = auto (藍白),
// completed = ok (松葉), cancelled = muted note, full = approve (黄金鈍).
function cohortStatusClass(status: Cohort['status']): string {
  if (status === 'completed') return 'badge ok';
  if (status === 'cancelled') return 'note';
  if (status === 'full') return 'badge approve';
  return 'badge auto';
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  border: '1px solid var(--line-strong)',
  borderRadius: 6,
  padding: '9px 12px',
  font: 'inherit',
  background: 'var(--surface)',
  minHeight: 44,
};

export function AdminCohortScheduler({ workshopId }: { workshopId: string }) {
  const t = useTranslations('Admin');
  const locale = useLocale() as 'en' | 'ja';

  const [cohorts, setCohorts] = useState<Cohort[]>([]);
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [capacity, setCapacity] = useState('20');
  const [priceJpy, setPriceJpy] = useState('45000');
  const [priceUsd, setPriceUsd] = useState('');
  const [format, setFormat] = useState<Format>('online');
  const [venueEn, setVenueEn] = useState('');
  const [venueJa, setVenueJa] = useState('');

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/workshops/${workshopId}`);
    if (!res.ok) return;
    const { workshop } = (await res.json()) as { workshop: { cohorts: Cohort[] } };
    setCohorts(workshop.cohorts ?? []);
  }, [workshopId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setMessage('');
    setError('');
    setBusy(true);
    try {
      const input: Record<string, unknown> = {
        workshopId,
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
        capacity: Number(capacity),
        priceJpy: Number(priceJpy),
        format,
      };
      if (priceUsd.trim()) input.priceUsd = Number(priceUsd);
      if (venueEn.trim() || venueJa.trim()) {
        input.venue = { en: venueEn, ja: venueJa };
      }

      const res = await fetch('/api/tools/execute', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ toolName: 'cohort.create', input }),
      });
      const data = (await res.json()) as ExecResult;
      if (!res.ok) {
        setError(data.error ?? t('cohortError'));
        return;
      }
      // approve-tier: proposed to the queue.
      setMessage(t('cohortNeedsApproval'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" data-testid="cohort-scheduler" style={{ marginTop: 'var(--sp-4)' }}>
      <h2>{t('cohortsHeading')}</h2>
      <p className="sub">{t('cohortsSubtitle')}</p>

      {message && (
        <p className="note" data-testid="cohort-message" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="error" data-testid="cohort-error" role="alert">
          {error}
        </p>
      )}

      {cohorts.length === 0 ? (
        <p className="note" data-testid="cohorts-empty">
          {t('cohortsEmpty')}
        </p>
      ) : (
        <table data-testid="cohort-table">
          <thead>
            <tr>
              <th>{t('cohortColDates')}</th>
              <th>{t('cohortColFormat')}</th>
              <th>{t('cohortColCapacity')}</th>
              <th style={{ textAlign: 'right' }}>{t('cohortColPriceJpy')}</th>
              <th style={{ textAlign: 'right' }}>{t('cohortColPriceUsd')}</th>
              <th>{t('cohortColStatus')}</th>
            </tr>
          </thead>
          <tbody>
            {cohorts.map((c) => (
              <tr key={c.id} data-testid="cohort-row">
                <td className="mono">
                  {formatDate(new Date(c.startsAt), locale)} –{' '}
                  {formatDate(new Date(c.endsAt), locale)}
                </td>
                <td>{t(`format_${c.format}`)}</td>
                <td className="mono">{c.capacity}</td>
                <td className="num">{c.priceJpy != null ? formatJpy(c.priceJpy, locale) : '—'}</td>
                <td className="num">{c.priceUsd != null ? formatUsd(c.priceUsd) : '—'}</td>
                <td>
                  <span className={cohortStatusClass(c.status)}>
                    {t(`cohortStatus_${c.status}`)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form onSubmit={create} style={{ marginTop: 'var(--sp-3)' }}>
        <div className="grid2">
          <div className="field">
            <label htmlFor="cohort-starts">{t('cohortStartsAt')}</label>
            <input
              id="cohort-starts"
              type="datetime-local"
              required
              data-testid="cohort-starts"
              style={inputStyle}
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="cohort-ends">{t('cohortEndsAt')}</label>
            <input
              id="cohort-ends"
              type="datetime-local"
              required
              data-testid="cohort-ends"
              style={inputStyle}
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
            />
          </div>
        </div>

        <div className="grid3">
          <div className="field">
            <label htmlFor="cohort-capacity">{t('cohortCapacity')}</label>
            <input
              id="cohort-capacity"
              type="number"
              min={1}
              required
              data-testid="cohort-capacity"
              style={inputStyle}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="cohort-price-jpy">{t('cohortPriceJpy')}</label>
            <input
              id="cohort-price-jpy"
              type="number"
              min={0}
              required
              data-testid="cohort-price-jpy"
              style={inputStyle}
              value={priceJpy}
              onChange={(e) => setPriceJpy(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="cohort-price-usd">{t('cohortPriceUsd')}</label>
            <input
              id="cohort-price-usd"
              type="number"
              min={0}
              data-testid="cohort-price-usd"
              style={inputStyle}
              value={priceUsd}
              onChange={(e) => setPriceUsd(e.target.value)}
            />
          </div>
        </div>

        <div className="grid3">
          <div className="field">
            <label htmlFor="cohort-format">{t('cohortFormat')}</label>
            <select
              id="cohort-format"
              data-testid="cohort-format"
              style={inputStyle}
              value={format}
              onChange={(e) => setFormat(e.target.value as Format)}
            >
              <option value="online">{t('format_online')}</option>
              <option value="in_person">{t('format_in_person')}</option>
              <option value="hybrid">{t('format_hybrid')}</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="cohort-venue-en">{t('cohortVenueEn')}</label>
            <input
              id="cohort-venue-en"
              data-testid="cohort-venue-en"
              style={inputStyle}
              value={venueEn}
              onChange={(e) => setVenueEn(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="cohort-venue-ja" lang="ja">
              {t('cohortVenueJa')}
            </label>
            <input
              id="cohort-venue-ja"
              lang="ja"
              data-testid="cohort-venue-ja"
              style={inputStyle}
              value={venueJa}
              onChange={(e) => setVenueJa(e.target.value)}
            />
          </div>
        </div>

        <button
          type="submit"
          className="btn pri"
          disabled={busy}
          data-testid="create-cohort"
          style={{ marginTop: 'var(--sp-1)' }}
        >
          {t('cohortCreate')}
        </button>
      </form>
    </section>
  );
}
