'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { LocalizationChip } from './LocalizationChip';
import { AdminCohortScheduler } from './AdminCohortScheduler';

type Level = 'intro' | 'intermediate' | 'advanced';

interface Bilingual {
  en?: string;
  ja?: string;
}

interface Workshop {
  id: string;
  title: Bilingual;
  summary: Bilingual;
  description: Bilingual;
  outcomes: Bilingual;
  level: Level;
  status: string;
  localizationReview: Bilingual;
  skills: string[];
}

interface ExecResult {
  actionId?: string;
  status?: string;
  requiresApproval?: boolean;
  output?: { workshopId?: string };
  error?: string;
}

async function execute(
  toolName: string,
  input: unknown,
): Promise<{ ok: boolean; data: ExecResult }> {
  const res = await fetch('/api/tools/execute', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ toolName, input }),
  });
  const data = (await res.json()) as ExecResult;
  return { ok: res.ok, data };
}

const EMPTY: Bilingual = {};

// Bilingual field: EN + JA side by side (DESIGN §7 — labels above fields, JA
// labels never truncate).
function BilingualField({
  fieldKey,
  label,
  value,
  onChange,
  multiline,
}: {
  fieldKey: string;
  label: string;
  value: Bilingual;
  onChange: (v: Bilingual) => void;
  multiline?: boolean;
}) {
  const t = useTranslations('Admin');
  const Control = multiline ? 'textarea' : 'input';
  return (
    <div className="field">
      <label>{label}</label>
      <div className="grid2">
        <div>
          <label htmlFor={`${fieldKey}-en`}>{t('labelEn')}</label>
          <Control
            id={`${fieldKey}-en`}
            data-testid={`field-${fieldKey}-en`}
            rows={multiline ? 3 : undefined}
            style={multiline ? { width: '100%', resize: 'vertical' } : undefined}
            value={value.en ?? ''}
            onChange={(e) => onChange({ ...value, en: e.target.value })}
          />
        </div>
        <div>
          <label htmlFor={`${fieldKey}-ja`} lang="ja">
            {t('labelJa')}
          </label>
          <Control
            id={`${fieldKey}-ja`}
            data-testid={`field-${fieldKey}-ja`}
            lang="ja"
            rows={multiline ? 3 : undefined}
            style={multiline ? { width: '100%', resize: 'vertical' } : undefined}
            value={value.ja ?? ''}
            onChange={(e) => onChange({ ...value, ja: e.target.value })}
          />
        </div>
      </div>
    </div>
  );
}

export function AdminWorkshopEditor({ workshopId }: { workshopId?: string }) {
  const t = useTranslations('Admin');
  const locale = useLocale() as 'en' | 'ja';
  const router = useRouter();
  const isNew = !workshopId;

  const [id, setId] = useState<string | undefined>(workshopId);
  const [title, setTitle] = useState<Bilingual>(EMPTY);
  const [summary, setSummary] = useState<Bilingual>(EMPTY);
  const [description, setDescription] = useState<Bilingual>(EMPTY);
  const [outcomes, setOutcomes] = useState<Bilingual>(EMPTY);
  const [level, setLevel] = useState<Level>('intro');
  const [skills, setSkills] = useState('');
  const [review, setReview] = useState<Bilingual>({});

  const [loaded, setLoaded] = useState(isNew);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!workshopId) return;
    const res = await fetch(`/api/admin/workshops/${workshopId}`);
    if (!res.ok) {
      setError(t('loadError'));
      setLoaded(true);
      return;
    }
    const { workshop } = (await res.json()) as { workshop: Workshop };
    setId(workshop.id);
    setTitle(workshop.title ?? {});
    setSummary(workshop.summary ?? {});
    setDescription(workshop.description ?? {});
    setOutcomes(workshop.outcomes ?? {});
    setLevel(workshop.level);
    setSkills((workshop.skills ?? []).join(', '));
    setReview(workshop.localizationReview ?? {});
    setLoaded(true);
  }, [workshopId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  function clearBanners() {
    setMessage('');
    setError('');
  }

  async function save() {
    clearBanners();
    if (!title.en?.trim()) {
      setError(t('titleEnRequired'));
      return;
    }
    setBusy(true);
    try {
      const skillList = skills
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      if (isNew || !id) {
        const { ok, data } = await execute('workshop.create', {
          title: { en: title.en, ...(title.ja ? { ja: title.ja } : {}) },
          summary: { en: summary.en ?? '', ...(summary.ja ? { ja: summary.ja } : {}) },
          ...(description.en || description.ja ? { description } : {}),
          ...(outcomes.en || outcomes.ja ? { outcomes } : {}),
          level,
          skills: skillList,
        });
        if (!ok) {
          setError(data.error ?? t('saveError'));
          return;
        }
        const newId = data.output?.workshopId;
        if (newId) {
          router.replace(`/admin/workshops/${newId}`, { locale });
        }
        setMessage(t('created'));
      } else {
        const { ok, data } = await execute('workshop.update', {
          workshopId: id,
          patch: { title, summary, description, outcomes, level },
        });
        if (!ok) {
          setError(data.error ?? t('saveError'));
          return;
        }
        setMessage(t('saved'));
      }
    } finally {
      setBusy(false);
    }
  }

  async function localizeJa() {
    if (!id) return;
    clearBanners();
    setBusy(true);
    try {
      const { ok, data } = await execute('content.localize', {
        entityType: 'workshop',
        entityId: id,
        targetLocale: 'ja',
        register: 'polite',
      });
      if (!ok) {
        setError(data.error ?? t('saveError'));
        return;
      }
      setMessage(t('localized'));
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function markJaReviewed() {
    if (!id) return;
    clearBanners();
    setBusy(true);
    try {
      const { ok, data } = await execute('content.mark_reviewed', {
        entityType: 'workshop',
        entityId: id,
        locale: 'ja',
      });
      if (!ok) {
        setError(data.error ?? t('saveError'));
        return;
      }
      // approve-tier: goes to the queue, not applied immediately.
      setMessage(t('needsApproval'));
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!id) return;
    clearBanners();
    setBusy(true);
    try {
      const { ok, data } = await execute('workshop.publish', { workshopId: id });
      if (!ok) {
        setError(data.error ?? t('saveError'));
        return;
      }
      setMessage(t('needsApproval'));
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) {
    return <p className="note">…</p>;
  }

  return (
    <div>
      <div className="row" style={{ marginBottom: 'var(--sp-2)' }}>
        <Link href="/admin/workshops" data-testid="back-to-list">
          ← {t('backToList')}
        </Link>
      </div>

      {message && (
        <p className="note" data-testid="editor-message" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="error" data-testid="editor-error" role="alert">
          {error}
        </p>
      )}

      {!isNew && (
        <div className="field">
          <label>{t('localizationStatus')}</label>
          <span className="row" style={{ gap: 'var(--sp-1)' }}>
            <LocalizationChip locale="en" state={review.en} />
            <LocalizationChip locale="ja" state={review.ja} />
          </span>
        </div>
      )}

      <BilingualField fieldKey="title" label={t('fieldTitle')} value={title} onChange={setTitle} />
      <BilingualField
        fieldKey="summary"
        label={t('fieldSummary')}
        value={summary}
        onChange={setSummary}
        multiline
      />
      <BilingualField
        fieldKey="description"
        label={t('fieldDescription')}
        value={description}
        onChange={setDescription}
        multiline
      />
      <BilingualField
        fieldKey="outcomes"
        label={t('fieldOutcomes')}
        value={outcomes}
        onChange={setOutcomes}
        multiline
      />

      <div className="grid2">
        <div className="field">
          <label htmlFor="level-select">{t('fieldLevel')}</label>
          <select
            id="level-select"
            data-testid="field-level"
            value={level}
            onChange={(e) => setLevel(e.target.value as Level)}
            style={{
              width: '100%',
              border: '1px solid var(--line-strong)',
              borderRadius: 6,
              padding: '9px 12px',
              font: 'inherit',
              background: 'var(--surface)',
              minHeight: 44,
            }}
          >
            <option value="intro">{t('level_intro')}</option>
            <option value="intermediate">{t('level_intermediate')}</option>
            <option value="advanced">{t('level_advanced')}</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="skills-input">{t('fieldSkills')}</label>
          <input
            id="skills-input"
            data-testid="field-skills"
            value={skills}
            onChange={(e) => setSkills(e.target.value)}
            placeholder={t('skillsHint')}
          />
        </div>
      </div>

      <div className="row" style={{ marginTop: 'var(--sp-2)' }}>
        <button
          type="button"
          className="btn pri"
          disabled={busy}
          onClick={save}
          data-testid="save-workshop"
        >
          {isNew ? t('create') : t('save')}
        </button>
        {!isNew && (
          <>
            <button
              type="button"
              className="btn sec"
              disabled={busy}
              onClick={localizeJa}
              data-testid="localize-ja"
            >
              {t('localizeJa')}
            </button>
            <button
              type="button"
              className="btn sec"
              disabled={busy}
              onClick={markJaReviewed}
              data-testid="mark-ja-reviewed"
            >
              {t('markJaReviewed')}
            </button>
            <button
              type="button"
              className="btn sec"
              disabled={busy}
              onClick={publish}
              data-testid="publish-workshop"
            >
              {t('publish')}
            </button>
          </>
        )}
      </div>

      {!isNew && id && <AdminCohortScheduler workshopId={id} />}
      {isNew && (
        <p className="note" style={{ marginTop: 'var(--sp-3)' }}>
          {t('cohortSaveFirst')}
        </p>
      )}
    </div>
  );
}
