import { z } from 'zod';
import type { ToolDefinition } from '../types';
import {
  getMetric,
  selectMetric,
  windowFor,
  priorWindowFor,
  isMetricName,
  METRIC_NAMES,
  TIMEFRAMES,
  type EvidenceRow,
  type MetricName,
  type Timeframe,
} from '../analytics/semantic-layer';

// Narrative-analytics tools (COPILOT_TOOLS §6). Both run over the SAFELISTED
// semantic layer: the model can only name a metric + timeframe from a fixed
// enum, and every number is produced by a hand-written parameterized Prisma
// query. There is NO path from model output to raw SQL. The question / metric
// name is treated strictly as DATA.

// ── analytics.query — auto, read-only over the semantic layer ────────────────
const queryInput = z.object({
  question: z.string().trim().min(1).max(500),
  timeframe: z.enum(TIMEFRAMES as unknown as [Timeframe, ...Timeframe[]]).optional(),
});
type QueryInput = z.infer<typeof queryInput>;

export interface AnalyticsQueryOutput {
  metric: MetricName;
  metricLabel: { en: string; ja: string };
  value: number;
  unit: 'jpy' | 'count' | 'ratio';
  timeframe: Timeframe;
  provider: 'anthropic' | 'stub';
  evidence: EvidenceRow[];
}

export const analyticsQuery: ToolDefinition<QueryInput, AnalyticsQueryOutput> = {
  name: 'analytics.query',
  tier: 'auto', // read-only
  surfaces: ['copilot'],
  input: queryInput,
  summarize: (i) => ({
    en: `Answer analytics question: ${i.question.slice(0, 60)}`,
    ja: `分析の質問に回答：${i.question.slice(0, 60)}`,
  }),
  handler: async (ctx, i) => {
    // Model (or offline stub) picks a metric NAME + timeframe. selectMetric
    // validates the returned name against the safelist — an out-of-safelist name
    // is ignored. The question never becomes SQL or a query filter.
    const selection = await selectMetric(i.question, i.timeframe);
    // Second guard: getMetric throws unless the name is safelisted.
    const metric = getMetric(selection.metric);
    const { from, to } = windowFor(selection.timeframe);
    const result = await metric.compute(ctx.tx, { from, to });
    return {
      metric: metric.name,
      metricLabel: metric.label,
      value: result.value,
      unit: result.unit,
      timeframe: selection.timeframe,
      provider: selection.provider,
      evidence: result.evidence,
    };
  },
};

// ── analytics.explain_change — auto, current vs prior period + narrative ─────
const explainInput = z.object({
  // The metric MUST be a safelisted name — validated by the enum here and again
  // by getMetric. The model can never pass an arbitrary metric.
  metric: z.enum(METRIC_NAMES as unknown as [MetricName, ...MetricName[]]),
  period: z.enum(TIMEFRAMES as unknown as [Timeframe, ...Timeframe[]]),
});
type ExplainInput = z.infer<typeof explainInput>;

export interface ExplainChangeOutput {
  metric: MetricName;
  metricLabel: { en: string; ja: string };
  period: Timeframe;
  current: { value: number; evidence: EvidenceRow[] };
  prior: { value: number; evidence: EvidenceRow[] } | null;
  delta: number | null;
  deltaPct: number | null;
  narrative: { en: string; ja: string };
}

// Localized timeframe words — never interpolate the raw English enum into JA.
const PERIOD_EN: Record<Timeframe, string> = {
  week: 'this week',
  month: 'this month',
  quarter: 'this quarter',
  all: 'all time',
};
const PERIOD_JA: Record<Timeframe, string> = {
  week: '今週',
  month: '今月',
  quarter: '今四半期',
  all: '全期間',
};
const PRIOR_EN: Record<Timeframe, string> = {
  week: 'the prior week',
  month: 'the prior month',
  quarter: 'the prior quarter',
  all: 'the prior period',
};
const PRIOR_JA: Record<Timeframe, string> = {
  week: '前週',
  month: '前月',
  quarter: '前四半期',
  all: '前期間',
};

/** Deterministic bilingual narrative from the two numbers. Data only — no model
 * needed for the stub; Anthropic can enrich this later without changing shape. */
function deterministicNarrative(
  label: { en: string; ja: string },
  period: Timeframe,
  current: number,
  prior: number | null,
  unit: 'jpy' | 'count' | 'ratio',
): { en: string; ja: string } {
  const fmt = (v: number) =>
    unit === 'jpy' ? `¥${v.toLocaleString('en-US')}` : unit === 'ratio' ? `${v}` : `${v}`;
  if (prior === null) {
    return {
      en: `${label.en} is ${fmt(current)} for ${PERIOD_EN[period]}. No prior period to compare (all-time).`,
      ja: `${label.ja}は${PERIOD_JA[period]}で${fmt(current)}です。比較対象の前期間はありません（全期間）。`,
    };
  }
  const delta = current - prior;
  const direction =
    delta > 0
      ? { en: 'rose', ja: '増加しました' }
      : delta < 0
        ? { en: 'fell', ja: '減少しました' }
        : { en: 'was flat', ja: '横ばいでした' };
  const pct = prior !== 0 ? Math.round((delta / prior) * 1000) / 10 : null;
  const pctEn = pct === null ? '' : ` (${pct > 0 ? '+' : ''}${pct}%)`;
  const pctJa = pct === null ? '' : `（${pct > 0 ? '+' : ''}${pct}%）`;
  return {
    en: `${label.en} ${direction.en} from ${fmt(prior)} to ${fmt(current)}${pctEn} versus ${PRIOR_EN[period]}. The evidence rows list the concrete records behind each figure.`,
    ja: `${label.ja}は${PRIOR_JA[period]}の${fmt(prior)}から${fmt(current)}へ${direction.ja}${pctJa}。各数値の根拠となるレコードはevidenceに一覧しています。`,
  };
}

export const analyticsExplainChange: ToolDefinition<ExplainInput, ExplainChangeOutput> = {
  name: 'analytics.explain_change',
  tier: 'auto',
  surfaces: ['copilot'],
  input: explainInput,
  summarize: (i) => ({
    en: `Explain ${getMetric(i.metric).label.en} change over ${PERIOD_EN[i.period]}`,
    ja: `${getMetric(i.metric).label.ja}の${PERIOD_JA[i.period]}の変化を説明`,
  }),
  handler: async (ctx, i) => {
    // Defensive: the enum already guarantees this, but keep the safelist guard.
    if (!isMetricName(i.metric)) throw new Error(`Unknown metric: ${i.metric}`);
    const metric = getMetric(i.metric);

    const cur = windowFor(i.period);
    const currentResult = await metric.compute(ctx.tx, { from: cur.from, to: cur.to });

    const prev = priorWindowFor(i.period);
    let prior: { value: number; evidence: EvidenceRow[] } | null = null;
    if (prev.from !== null && prev.to !== null) {
      const priorResult = await metric.compute(ctx.tx, { from: prev.from, to: prev.to });
      prior = { value: priorResult.value, evidence: priorResult.evidence };
    }

    const delta = prior ? currentResult.value - prior.value : null;
    const deltaPct =
      prior && prior.value !== 0
        ? Math.round(((currentResult.value - prior.value) / prior.value) * 1000) / 10
        : null;

    return {
      metric: metric.name,
      metricLabel: metric.label,
      period: i.period,
      current: { value: currentResult.value, evidence: currentResult.evidence },
      prior,
      delta,
      deltaPct,
      narrative: deterministicNarrative(
        metric.label,
        i.period,
        currentResult.value,
        prior ? prior.value : null,
        currentResult.unit,
      ),
    };
  },
};
