'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';

interface ExecResult {
  output?: { assignedUserIds?: string[] };
  error?: string;
}

// Invite employees onto the org's active seat pool (COPILOT_TOOLS org.assign_seats,
// auto-tier). Emails are comma/newline separated; the server upserts participant
// users and emails a locale-aware invite. Seats are consumed at enrollment, not here.
export function OrgInviteEmployees({ seatPoolId }: { seatPoolId: string | null }) {
  const t = useTranslations('OrgPortal');
  const router = useRouter();

  const [emails, setEmails] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function assign() {
    setMessage('');
    setError('');
    if (!seatPoolId) return;

    const list = emails
      .split(/[,\n]/)
      .map((e) => e.trim())
      .filter(Boolean);
    if (list.length === 0) {
      setError(t('emailsRequired'));
      return;
    }

    setBusy(true);
    try {
      const res = await fetch('/api/tools/execute', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          toolName: 'org.assign_seats',
          input: { seatPoolId, userEmails: list },
        }),
      });
      const data = (await res.json()) as ExecResult;
      if (!res.ok) {
        setError(data.error ?? t('assignError'));
        return;
      }
      const count = data.output?.assignedUserIds?.length ?? list.length;
      setMessage(t('assignSuccess', { count }));
      setEmails('');
      router.refresh();
    } catch {
      setError(t('assignError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="field" style={{ marginTop: 'var(--sp-3)' }}>
      <h2>{t('inviteHeading')}</h2>
      <p className="note">{t('inviteHelp')}</p>

      {seatPoolId === null ? (
        <p className="note" role="status">
          {t('noSeatPool')}
        </p>
      ) : (
        <>
          <label htmlFor="assign-emails">{t('inviteLabel')}</label>
          <textarea
            id="assign-emails"
            data-testid="assign-emails"
            rows={3}
            style={{ width: '100%', resize: 'vertical', minHeight: 44 }}
            value={emails}
            onChange={(e) => setEmails(e.target.value)}
            placeholder={t('invitePlaceholder')}
          />
          <div className="row" style={{ marginTop: 'var(--sp-2)' }}>
            <button
              type="button"
              className="btn pri"
              disabled={busy}
              onClick={assign}
              data-testid="assign-seats"
            >
              {busy ? t('assignBusy') : t('assignSeats')}
            </button>
          </div>
          {message && (
            <p
              className="note"
              data-testid="assign-message"
              role="status"
              style={{ marginTop: 'var(--sp-1)' }}
            >
              {message}
            </p>
          )}
          {error && (
            <p
              className="error"
              data-testid="assign-error"
              role="alert"
              style={{ marginTop: 'var(--sp-1)' }}
            >
              {error}
            </p>
          )}
        </>
      )}
    </div>
  );
}
