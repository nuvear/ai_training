'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';

interface ChatMessage {
  role: 'user' | 'ai';
  text: string;
}

// Public concierge chat. Reuses the copilot surface styles (.chat / .msg.claude)
// so the AI's replies carry the accent left-border and a "Concierge (AI)" label —
// the assistant is always marked, never disguised as a human (DESIGN §7, §9).
export function ConciergeChat() {
  const t = useTranslations('Concierge');
  const locale = useLocale() as 'en' | 'ja';

  const [messages, setMessages] = useState<ChatMessage[]>([{ role: 'ai', text: t('greeting') }]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = message.trim();
    if (!text || busy) return;
    setBusy(true);
    setMessages((m) => [...m, { role: 'user', text }]);
    setMessage('');

    try {
      const res = await fetch('/api/concierge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: text, locale }),
      });
      const data = await res.json();
      const reply = res.ok && typeof data.message === 'string' ? data.message : t('errorReply');
      setMessages((m) => [...m, { role: 'ai', text: reply }]);
    } catch {
      setMessages((m) => [...m, { role: 'ai', text: t('errorReply') }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="chat" data-testid="concierge-chat">
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role === 'user' ? 'user' : 'claude'}`}>
            <div className="who">{m.role === 'user' ? t('you') : t('aiLabel')}</div>
            <div data-testid={m.role === 'ai' ? 'concierge-reply' : undefined}>{m.text}</div>
          </div>
        ))}
      </div>

      <form className="cmd" onSubmit={send}>
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={t('placeholder')}
          aria-label={t('inputLabel')}
          data-testid="concierge-input"
        />
        <button type="submit" className="btn pri" disabled={busy} data-testid="concierge-send">
          {t('send')}
        </button>
      </form>
    </div>
  );
}
