'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

export function SignInForm() {
  const t = useTranslations('Auth');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [devUrl, setDevUrl] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('sending');
    setDevUrl(null);
    try {
      const res = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error('request failed');
      const data = (await res.json()) as { devLoginUrl?: string };
      setDevUrl(data.devLoginUrl ?? null);
      setStatus('sent');
    } catch {
      setStatus('error');
    }
  }

  return (
    <form onSubmit={submit} className="panel" style={{ maxWidth: 420 }}>
      <div className="field">
        <label htmlFor="email">{t('emailLabel')}</label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          data-testid="email-input"
        />
      </div>
      <button
        type="submit"
        className="btn pri"
        disabled={status === 'sending'}
        data-testid="send-link"
      >
        {t('sendLink')}
      </button>

      {status === 'sent' && (
        <div className="stack" style={{ marginTop: 16 }}>
          <p className="note" data-testid="link-sent">
            {t('linkSent')}
          </p>
          {devUrl && (
            <p className="note">
              {t('devLinkNote')}{' '}
              <a href={devUrl} data-testid="dev-login-link">
                {devUrl}
              </a>
            </p>
          )}
        </div>
      )}
      {status === 'error' && (
        <p className="error" style={{ marginTop: 12 }}>
          {t('unknownError')}
        </p>
      )}
    </form>
  );
}
