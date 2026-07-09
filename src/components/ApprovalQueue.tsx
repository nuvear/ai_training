'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { AiTier } from '@/generated/prisma';
import { TierBadge } from './TierBadge';

interface Row {
  id: string;
  toolName: string;
  tier: AiTier;
  status: string;
  createdAt: string;
  summary: { en: string; ja: string };
}

export function ApprovalQueue() {
  const t = useTranslations('Approvals');
  const tTier = useTranslations('Tier');
  const locale = useLocale() as 'en' | 'ja';
  const [rows, setRows] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/approvals');
    const data = await res.json();
    setRows(data.actions ?? []);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(id: string, action: 'approve' | 'reject') {
    setBusy(true);
    try {
      await fetch(`/api/approvals/${id}/${action}`, { method: 'POST' });
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (loaded && rows.length === 0) {
    return (
      <p className="note" data-testid="approvals-empty">
        {t('empty')}
      </p>
    );
  }

  return (
    <table data-testid="approvals-table">
      <thead>
        <tr>
          <th>{t('colTool')}</th>
          <th>{t('colTier')}</th>
          <th>{t('colRequested')}</th>
          <th aria-label="actions" />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} data-testid="approval-row">
            <td>
              <span className="mono">{r.toolName}</span>
              <div className="note">{r.summary[locale]}</div>
            </td>
            <td>
              <TierBadge tier={r.tier} label={tTier(r.tier)} />
            </td>
            <td className="mono note">{new Date(r.createdAt).toLocaleString(locale)}</td>
            <td>
              <span className="row">
                <button
                  type="button"
                  className="btn pri"
                  disabled={busy}
                  onClick={() => decide(r.id, 'approve')}
                  data-testid="row-approve"
                >
                  {t('approve')}
                </button>
                <button
                  type="button"
                  className="btn danger"
                  disabled={busy}
                  onClick={() => decide(r.id, 'reject')}
                  data-testid="row-reject"
                >
                  {t('reject')}
                </button>
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
