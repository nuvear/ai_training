'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { AiTier } from '@/generated/prisma';
import { TierBadge } from './TierBadge';

// A single planned step as returned by POST /api/copilot/plan. `state` is a
// client-only view of what happened after /run: proposed steps whose effective
// tier is auto become `executed`; approve/owner steps become `queued` (they wait
// in the approval queue).
type StepState = 'proposed' | 'executed' | 'queued';

interface PlanStep {
  actionId: string;
  seq: number;
  toolName: string;
  tier: AiTier;
  summary: { en: string; ja: string };
  state: StepState;
}

interface ChatMessage {
  role: 'user' | 'copilot';
  text: string;
}

// POST /api/copilot/plan → { parentId, recognized, steps: [{ actionId, seq, toolName, tier, summary }] }
interface PlanResponse {
  parentId: string;
  recognized: boolean;
  steps: Array<{
    actionId: string;
    seq: number;
    toolName: string;
    tier: AiTier;
    summary: { en: string; ja: string };
  }>;
}

// POST /api/copilot/plan/<parentId>/run → { status, executed: string[], pending: string[] }
interface RunResponse {
  status: 'running' | 'complete';
  executed: string[];
  pending: string[];
}

export function CopilotConsole({ firstName }: { firstName: string }) {
  const t = useTranslations('Copilot');
  const tTier = useTranslations('Tier');
  const locale = useLocale() as 'en' | 'ja';

  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'copilot', text: t('greeting', { name: firstName }) },
  ]);
  const [parentId, setParentId] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanStep[]>([]);
  const [ran, setRan] = useState(false);
  const [command, setCommand] = useState('');
  const [busy, setBusy] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = command.trim();
    if (!text || busy) return;
    setBusy(true);
    setMessages((m) => [...m, { role: 'user', text }]);
    setCommand('');
    setPlan([]);
    setParentId(null);
    setRan(false);

    try {
      const res = await fetch('/api/copilot/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ command: text, locale }),
      });
      const data = (await res.json()) as PlanResponse;
      if (!res.ok || data.recognized === false || !data.steps?.length) {
        setMessages((m) => [...m, { role: 'copilot', text: t('notRecognized') }]);
        return;
      }
      setParentId(data.parentId);
      setPlan(data.steps.map((s) => ({ ...s, state: 'proposed' as StepState })));
      setMessages((m) => [...m, { role: 'copilot', text: t('planReply') }]);
    } catch {
      setMessages((m) => [...m, { role: 'copilot', text: t('error') }]);
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    if (!parentId || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/copilot/plan/${parentId}/run`, { method: 'POST' });
      const data = (await res.json()) as RunResponse;
      if (!res.ok) {
        setMessages((m) => [...m, { role: 'copilot', text: t('error') }]);
        return;
      }
      const executed = new Set(data.executed);
      let queuedCount = 0;
      setPlan((p) =>
        p.map((s) => {
          if (executed.has(s.actionId)) return { ...s, state: 'executed' as StepState };
          queuedCount++;
          return { ...s, state: 'queued' as StepState };
        }),
      );
      setRan(true);
      setMessages((m) => [
        ...m,
        {
          role: 'copilot',
          text:
            queuedCount > 0
              ? t('runReplyQueued', { queued: queuedCount, executed: data.executed.length })
              : t('runReplyDone', { executed: data.executed.length }),
        },
      ]);
    } catch {
      setMessages((m) => [...m, { role: 'copilot', text: t('error') }]);
    } finally {
      setBusy(false);
    }
  }

  function stepStatus(step: PlanStep) {
    if (step.state === 'executed') {
      return <span className="badge ok">{t('stateExecuted')}</span>;
    }
    if (step.state === 'queued') {
      return <span className="badge approve">{t('stateQueued')}</span>;
    }
    return null;
  }

  return (
    <div>
      <div className="chat" data-testid="copilot-chat">
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role === 'user' ? 'user' : 'claude'}`}>
            <div className="who">{m.role === 'user' ? t('you') : t('aiLabel')}</div>
            <div>{m.text}</div>
          </div>
        ))}

        {plan.length > 0 && (
          <div className="msg claude" data-testid="plan-preview">
            <div className="who">{t('aiLabel')}</div>
            <div>{t('planHeading')}</div>
            <ul className="plan">
              {plan.map((step) => (
                <li key={step.actionId} data-testid="plan-step">
                  <span>
                    <span className="mono">{step.toolName}</span> — {step.summary[locale]}
                  </span>
                  <span className="row">
                    {stepStatus(step)}
                    <TierBadge tier={step.tier} label={tTier(step.tier)} />
                  </span>
                </li>
              ))}
            </ul>
            {!ran ? (
              <div className="row" style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="btn pri"
                  disabled={busy}
                  onClick={run}
                  data-testid="approve-plan-run"
                >
                  {t('approvePlanRun')}
                </button>
                <button type="button" className="btn sec" disabled={busy}>
                  {t('edit')}
                </button>
              </div>
            ) : (
              plan.some((s) => s.state === 'queued') && (
                <p className="note" style={{ marginTop: 12 }} data-testid="awaiting-note">
                  {t('awaitingNote')}
                </p>
              )
            )}
          </div>
        )}
      </div>

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
