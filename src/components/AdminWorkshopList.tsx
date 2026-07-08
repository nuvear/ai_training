'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { LocalizationChip } from './LocalizationChip';

interface WorkshopRow {
  id: string;
  title: { en?: string; ja?: string };
  summary: { en?: string; ja?: string };
  level: 'intro' | 'intermediate' | 'advanced';
  status: 'draft' | 'published' | 'archived';
  localizationReview: { en?: string; ja?: string };
}

// Workshop status → tier-badge tint (DESIGN §7): published = ok (松葉),
// draft = auto (藍白), archived = muted note.
function statusClass(status: WorkshopRow['status']): string {
  if (status === 'published') return 'badge ok';
  if (status === 'draft') return 'badge auto';
  return 'note';
}

export function AdminWorkshopList() {
  const t = useTranslations('Admin');
  const [rows, setRows] = useState<WorkshopRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const res = await fetch('/api/admin/workshops');
      const data = await res.json();
      if (active) {
        setRows(data.workshops ?? []);
        setLoaded(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div>
      <div className="row" style={{ marginBottom: 'var(--sp-3)' }}>
        <Link href="/admin/workshops/new" className="btn pri" data-testid="new-workshop">
          {t('newWorkshop')}
        </Link>
      </div>

      {loaded && rows.length === 0 ? (
        <p className="note" data-testid="admin-empty">
          {t('empty')}
        </p>
      ) : (
        <table data-testid="workshop-table">
          <thead>
            <tr>
              <th>{t('colTitle')}</th>
              <th>{t('colLevel')}</th>
              <th>{t('colStatus')}</th>
              <th>{t('colLocalization')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((w) => (
              <tr key={w.id} data-testid="workshop-row">
                <td>
                  <Link href={`/admin/workshops/${w.id}`} data-testid="workshop-link">
                    {w.title.en || w.title.ja || '—'}
                  </Link>
                  <div className="note" lang="ja">
                    {w.title.ja || '—'}
                  </div>
                </td>
                <td>{t(`level_${w.level}`)}</td>
                <td>
                  <span className={statusClass(w.status)}>{t(`status_${w.status}`)}</span>
                </td>
                <td>
                  <span className="row" style={{ gap: 'var(--sp-1)' }}>
                    <LocalizationChip locale="en" state={w.localizationReview?.en} />
                    <LocalizationChip locale="ja" state={w.localizationReview?.ja} />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
