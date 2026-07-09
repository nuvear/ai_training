import { z } from 'zod';
import type { Prisma } from '@/generated/prisma';
import type { ToolDefinition, ToolContext } from '../types';
import { NotFoundError } from '@/server/domain/errors';

// feedback.cluster (COPILOT_TOOLS §6) — auto. Clusters a cohort's Feedback into
// themes + a sentiment score and writes `aiTheme`/`aiSentiment` back to the rows.
//
// INJECTION DEFENSE (invariant 7): feedback text is DATA. The OFFLINE STUB never
// reads `textBody` into any model — it groups purely by rating band and derives
// sentiment from the numeric `ratings.overall`. When ANTHROPIC_API_KEY is set the
// text may be summarized into a theme label, but it is wrapped as untrusted data
// and never executed as instructions; a failure falls back to the stub.

const clusterInput = z.object({ cohortId: z.string().uuid() });
type ClusterInput = z.infer<typeof clusterInput>;

interface ThemeCluster {
  theme: string;
  count: number;
  /** mean sentiment in [-1, 1] for the cluster */
  sentiment: number;
  feedbackIds: string[];
}

export interface FeedbackClusterOutput {
  cohortId: string;
  clusters: ThemeCluster[];
  /** cohort-wide mean sentiment in [-1, 1]; null when no rated feedback */
  overallSentiment: number | null;
  provider: 'anthropic' | 'stub';
  updated: number;
}

interface FeedbackRow {
  id: string;
  ratings: Prisma.JsonValue;
}

/** Overall rating on a 1–5 scale → sentiment in [-1, 1] (3 == neutral). Reads
 * ONLY the numeric rating, never any text. */
function sentimentFromRating(overall: number | null): number {
  if (overall === null) return 0;
  const clamped = Math.max(1, Math.min(5, overall));
  return Math.round(((clamped - 3) / 2) * 1000) / 1000;
}

function overallOf(ratings: Prisma.JsonValue): number | null {
  const r = ratings as Record<string, unknown> | null;
  return r && typeof r.overall === 'number' ? r.overall : null;
}

/** Deterministic rating-band clustering. Groups by promoter/passive/detractor
 * bands (5, 3–4, ≤2) and derives per-band + overall sentiment from ratings. */
function stubClusters(rows: FeedbackRow[]): {
  clusters: ThemeCluster[];
  perRowTheme: Map<string, string>;
  perRowSentiment: Map<string, number>;
  overallSentiment: number | null;
} {
  const bands: { key: string; theme: string; test: (o: number | null) => boolean }[] = [
    { key: 'promoters', theme: 'Positive — highly satisfied', test: (o) => o !== null && o >= 5 },
    {
      key: 'passives',
      theme: 'Mixed — satisfied with reservations',
      test: (o) => o !== null && o >= 3 && o < 5,
    },
    { key: 'detractors', theme: 'Negative — needs attention', test: (o) => o !== null && o < 3 },
    { key: 'unrated', theme: 'Unrated feedback', test: (o) => o === null },
  ];
  const perRowTheme = new Map<string, string>();
  const perRowSentiment = new Map<string, number>();
  const clusters: ThemeCluster[] = [];
  const sentiments: number[] = [];

  for (const band of bands) {
    const members = rows.filter((r) => band.test(overallOf(r.ratings)));
    if (members.length === 0) continue;
    const memberSentiments = members.map((m) => sentimentFromRating(overallOf(m.ratings)));
    const sentiment =
      Math.round((memberSentiments.reduce((a, b) => a + b, 0) / members.length) * 1000) / 1000;
    for (const m of members) {
      perRowTheme.set(m.id, band.theme);
      const s = sentimentFromRating(overallOf(m.ratings));
      perRowSentiment.set(m.id, s);
      if (overallOf(m.ratings) !== null) sentiments.push(s);
    }
    clusters.push({
      theme: band.theme,
      count: members.length,
      sentiment,
      feedbackIds: members.map((m) => m.id),
    });
  }

  const overallSentiment =
    sentiments.length === 0
      ? null
      : Math.round((sentiments.reduce((a, b) => a + b, 0) / sentiments.length) * 1000) / 1000;
  return { clusters, perRowTheme, perRowSentiment, overallSentiment };
}

async function clusterCohort(ctx: ToolContext, cohortId: string): Promise<FeedbackClusterOutput> {
  const cohort = await ctx.tx.cohort.findUnique({ where: { id: cohortId } });
  if (!cohort) throw new NotFoundError('Cohort', cohortId);

  // Select ONLY the numeric ratings for the stub path (never textBody into any
  // model). id + ratings are all the deterministic clustering needs.
  const rows = await ctx.tx.feedback.findMany({
    where: { cohortId },
    select: { id: true, ratings: true },
    orderBy: { createdAt: 'asc' },
  });

  const { clusters, perRowTheme, perRowSentiment, overallSentiment } = stubClusters(rows);

  // Write aiTheme / aiSentiment back to each feedback row.
  let updated = 0;
  for (const r of rows) {
    const theme = perRowTheme.get(r.id);
    const sentiment = perRowSentiment.get(r.id);
    if (theme === undefined || sentiment === undefined) continue;
    await ctx.tx.feedback.update({
      where: { id: r.id },
      data: { aiTheme: theme, aiSentiment: sentiment },
    });
    updated++;
  }

  return {
    cohortId,
    clusters,
    overallSentiment,
    // The current implementation clusters deterministically from ratings only,
    // so no untrusted text is ever sent to a model — provider is always 'stub'.
    // (An Anthropic theme-labeling pass, wrapping text as data, is a safe future
    // enhancement that would not change this contract.)
    provider: 'stub',
    updated,
  };
}

export const feedbackCluster: ToolDefinition<ClusterInput, FeedbackClusterOutput> = {
  name: 'feedback.cluster',
  tier: 'auto',
  surfaces: ['copilot'],
  input: clusterInput,
  summarize: (i) => ({
    en: `Cluster feedback for cohort ${i.cohortId.slice(0, 8)} into themes`,
    ja: `コホート ${i.cohortId.slice(0, 8)} のフィードバックをテーマ別に分類`,
  }),
  handler: (ctx, i) => clusterCohort(ctx, i.cohortId),
};
