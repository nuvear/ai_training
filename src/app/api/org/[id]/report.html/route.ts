import { NextResponse, type NextRequest } from 'next/server';
import { requireOrgAccess } from '@/server/auth/org-access';
import { generateOrgReport } from '@/server/domain/org-report';
import { renderReportHtml } from '@/server/pdf/report-pdf';
import { toErrorResponse } from '@/server/http';

// GET /api/org/[id]/report.html?period=2026-06 — the same bilingual monthly report
// as HTML. Guarded: org_admin of this org, or owner/staff.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await requireOrgAccess(id);
    const period = req.nextUrl.searchParams.get('period')?.trim() || defaultPeriod();

    const report = await generateOrgReport(id, period);
    const html = renderReportHtml(report);

    return new NextResponse(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

function defaultPeriod(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}
