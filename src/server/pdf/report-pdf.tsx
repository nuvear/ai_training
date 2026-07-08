import 'server-only';
import React from 'react';
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from '@react-pdf/renderer';
import { formatPeriod, type OrgReport } from '@/server/domain/org-report';
import { ensureFonts, JP_FONT } from './fonts';

// ─────────────────────────────────────────────────────────────────────────────
// Org monthly report — bilingual PDF + HTML, rendered from report.org_progress
// output. Carries the founder authored-by line on the cover (DESIGN §2.1). The
// aggregates are numbers only; no free-text feedback ever reaches this surface.
// ─────────────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  page: { fontFamily: JP_FONT, fontSize: 11, padding: 48, color: '#1a1a1a', lineHeight: 1.6 },
  brand: { fontSize: 10, color: '#666', marginBottom: 4 },
  titleJa: { fontSize: 20 },
  titleEn: { fontSize: 12, color: '#555', marginBottom: 4 },
  author: { fontSize: 9, color: '#666', marginBottom: 20 },
  kpiRow: { flexDirection: 'row', marginBottom: 20 },
  kpi: {
    flex: 1,
    borderWidth: 0.5,
    borderColor: '#ccc',
    borderRadius: 4,
    padding: 8,
    marginRight: 8,
  },
  kpiLabel: { fontSize: 8, color: '#777' },
  kpiValue: { fontSize: 16, marginTop: 2 },
  h2: { fontSize: 12, marginTop: 12, marginBottom: 6, color: '#333' },
  para: { marginBottom: 12 },
  footer: {
    position: 'absolute',
    bottom: 30,
    left: 48,
    right: 48,
    fontSize: 8,
    color: '#888',
    textAlign: 'center',
  },
});

function ReportDocument({ report }: { report: OrgReport }) {
  const a = report.aggregates;
  const rating = a.avgRating === null ? '—' : String(a.avgRating);
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <Text style={s.brand}>WorkshopOS</Text>
        <Text style={s.titleJa}>
          {a.orgName.ja} 学習進捗レポート — {formatPeriod(a.period, 'ja')}
        </Text>
        <Text style={s.titleEn}>
          {a.orgName.en} — Learning progress report, {formatPeriod(a.period, 'en')}
        </Text>
        <Text style={s.author}>
          {report.author.en} / {report.author.ja}
        </Text>

        <View style={s.kpiRow}>
          <View style={s.kpi}>
            <Text style={s.kpiLabel}>Seats used / 利用席数</Text>
            <Text style={s.kpiValue}>
              {a.seatsUsed}/{a.seatsTotal}
            </Text>
          </View>
          <View style={s.kpi}>
            <Text style={s.kpiLabel}>Completions / 修了</Text>
            <Text style={s.kpiValue}>{a.completions}</Text>
          </View>
          <View style={s.kpi}>
            <Text style={s.kpiLabel}>Avg rating / 平均評価</Text>
            <Text style={s.kpiValue}>{rating}</Text>
          </View>
          <View style={[s.kpi, { marginRight: 0 }]}>
            <Text style={s.kpiLabel}>Members / 受講者</Text>
            <Text style={s.kpiValue}>{a.employeeCount}</Text>
          </View>
        </View>

        <Text style={s.h2}>Summary</Text>
        <Text style={s.para}>{report.narrative.en}</Text>
        <Text style={s.h2}>概要</Text>
        <Text style={s.para}>{report.narrative.ja}</Text>

        <Text style={s.footer}>
          WorkshopOS — {report.author.en} / {report.author.ja}
        </Text>
      </Page>
    </Document>
  );
}

/** Render the bilingual monthly report to a PDF Buffer (starts with %PDF). */
export async function renderReportPdf(report: OrgReport): Promise<Buffer> {
  ensureFonts();
  return renderToBuffer(<ReportDocument report={report} />);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Render the same bilingual report as a standalone HTML document. All dynamic
 * values are HTML-escaped — narrative and org names are treated as data. */
export function renderReportHtml(report: OrgReport): string {
  const a = report.aggregates;
  const rating = a.avgRating === null ? '&mdash;' : String(a.avgRating);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(a.orgName.en)} — ${escapeHtml(formatPeriod(a.period, 'en'))}</title>
<style>
  body { font-family: -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif; color: #1a1a1a; max-width: 720px; margin: 40px auto; padding: 0 20px; line-height: 1.6; }
  .brand { color: #666; font-size: 13px; }
  h1 { font-size: 24px; margin: 4px 0; }
  .sub { color: #555; font-size: 15px; }
  .author { color: #666; font-size: 12px; margin-bottom: 24px; }
  .kpis { display: flex; gap: 12px; margin: 20px 0; }
  .kpi { flex: 1; border: 1px solid #ccc; border-radius: 6px; padding: 10px; }
  .kpi .label { font-size: 11px; color: #777; }
  .kpi .value { font-size: 20px; }
  h2 { font-size: 15px; margin-top: 20px; }
  footer { margin-top: 40px; color: #888; font-size: 12px; text-align: center; }
</style>
</head>
<body>
  <div class="brand">WorkshopOS</div>
  <h1>${escapeHtml(a.orgName.ja)} 学習進捗レポート — ${escapeHtml(formatPeriod(a.period, 'ja'))}</h1>
  <div class="sub">${escapeHtml(a.orgName.en)} — Learning progress report, ${escapeHtml(formatPeriod(a.period, 'en'))}</div>
  <div class="author">${escapeHtml(report.author.en)} / ${escapeHtml(report.author.ja)}</div>
  <div class="kpis">
    <div class="kpi"><div class="label">Seats used / 利用席数</div><div class="value">${a.seatsUsed}/${a.seatsTotal}</div></div>
    <div class="kpi"><div class="label">Completions / 修了</div><div class="value">${a.completions}</div></div>
    <div class="kpi"><div class="label">Avg rating / 平均評価</div><div class="value">${rating}</div></div>
    <div class="kpi"><div class="label">Members / 受講者</div><div class="value">${a.employeeCount}</div></div>
  </div>
  <h2>Summary</h2>
  <p>${escapeHtml(report.narrative.en)}</p>
  <h2>概要</h2>
  <p>${escapeHtml(report.narrative.ja)}</p>
  <footer>WorkshopOS — ${escapeHtml(report.author.en)} / ${escapeHtml(report.author.ja)}</footer>
</body>
</html>`;
}
