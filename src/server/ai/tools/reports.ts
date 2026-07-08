import { z } from 'zod';
import type { ToolDefinition } from '../types';
import { buildOrgReport, type OrgReport } from '@/server/domain/org-report';

// report.org_progress (COPILOT_TOOLS §6) — auto-tier.
//
// Generates a bilingual AI narrative monthly report from the org-progress
// AGGREGATES (never free-text feedback). Anthropic (claude-opus-4-8) when keyed,
// else a deterministic bilingual stub. Includes the founder authored-by line
// (DESIGN §2.1). All data is treated as data (injection defense). The report
// builder is shared with the report PDF/HTML routes so logic never forks.

const reportInput = z.object({
  organizationId: z.string().uuid(),
  /** free-form period label, e.g. "2026-06" or "June 2026". */
  period: z.string().trim().min(1).max(40),
  locale: z.enum(['en', 'ja']),
});
type ReportInput = z.infer<typeof reportInput>;

export type OrgReportOutput = OrgReport;

export const reportOrgProgress: ToolDefinition<ReportInput, OrgReportOutput> = {
  name: 'report.org_progress',
  tier: 'auto',
  surfaces: ['copilot'],
  input: reportInput,
  summarize: (i) => ({
    en: `Generate ${i.period} progress report for org ${i.organizationId.slice(0, 8)}`,
    ja: `組織 ${i.organizationId.slice(0, 8)} の ${i.period} 進捗レポートを生成`,
  }),
  handler: async (ctx, i) => buildOrgReport(ctx.tx, i.organizationId, i.period),
};
