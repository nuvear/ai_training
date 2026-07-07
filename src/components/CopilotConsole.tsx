'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { AiTier } from '@/generated/prisma';
import { TierBadge } from './TierBadge';

interface PlanStep {
  actionId: string;
  toolName: string;
  tier: AiTier;
  status: string;
  summary: { en: string; ja: string };
  output?: { pong?: { en: string; ja: string } };
}

interface ChatMessage {
  role: 'user' | 'copilot';
  text: string;
}

export function CopilotConsole({ firstName }: { firstName: string }) {
  const t = useTranslations('Copilot');
  const tTier = useTranslations('Tier');
  const locale = useLocale() as 'en' | 'ja';

  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'copilot', text: t('greeting', { name: firstName }) },
  ]);
  const [plan, setPlan] = useState<PlanStep[]>([]);
  const [command, setCommand] = useState('');
  const [busy, setBusy] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = command.trim();
    if (!text || busy) return;
    setBusy(true);
    setMessages((m) => [...m, { role: 'user', text }]);
    setCommand('');

    try {
      const res = await fetch('/api/copilot/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ command: text }),
      });
      const data = await res.json();
      if (!res.ok || data.recognized === false) {
        setMessages((m) => [...m, { role: 'copilot', text: t('notRecognized') }]);
      } else {
        setPlan(data.plan);
        setMessages((m) => [...m, { role: 'copilot', text: t('planHeading') }]);
      }
    } finally {
      setBusy(false);
    }
  }

  async function decide(step: PlanStep, action: 'approve' | 'reject') {
    setBusy(true);
    try {
      const res = await fetch(`/api/approvals/${step.actionId}/${action}`, { method: 'POST' });
      const data = await res.json();
      setPlan((p) =>
        p.map((s) =>
          s.actionId === step.actionId ? { ...s, status: data.status, output: data.output } : s,
        ),
      );
      if (action === 'approve' && res.ok && data.status === 'executed') {
        setMessages((m) => [...m, { role: 'copilot', text: t('resultPong') }]);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="chat" data-testid="copilot-chat">
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role === 'user' ? 'user' : 'claude'}`}>
            <div className="who">{m.role === 'user' ? t('you') : t('reply')}</div>
            <div>{m.text}</div>
          </div>
        ))}
      </div>

      {plan.length > 0 && (
        <div className="panel" data-testid="plan-preview">
          <h2>{t('planHeading')}</h2>
          <ul className="plan">
            {plan.map((step) => (
              <li key={step.actionId} data-testid="plan-step">
                <span>
                  <TierBadge tier={step.tier} label={tTier(step.tier)} />{' '}
                  <span className="mono">{step.toolName}</span> — {step.summary[locale]}
                </span>
                {step.status === 'executed' ? (
                  <span className="badge ok" data-testid="step-executed">
                    {t('executed')} · {step.output?.pong?.[locale]}
                  </span>
                ) : step.status === 'rejected' ? (
                  <span className="badge owner">{step.status}</span>
                ) : (
                  <span className="row">
                    <button
                      type="button"
                      className="btn pri"
                      disabled={busy}
                      onClick={() => decide(step, 'approve')}
                      data-testid="approve-step"
                    >
                      {t('approve')}
                    </button>
                    <button
                      type="button"
                      className="btn danger"
                      disabled={busy}
                      onClick={() => decide(step, 'reject')}
                      data-testid="reject-step"
                    >
                      {t('reject')}
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <form className="cmd" onSubmit={send}>
        <input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder={t('placeholder')}
          aria-label={t('heading')}
          data-testid="copilot-input"
        />
        <button type="submit" className="btn pri" disabled={busy} data-testid="copilot-send">
          {t('send')}
        </button>
      </form>
    </div>
  );
}
