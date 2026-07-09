import { NextResponse, type NextRequest } from 'next/server';
import { requireOrgAccess } from '@/server/auth/org-access';
import { generateOrgReport } from '@/server/domain/org-report';
import { renderReportPdf } from '@/server/pdf/report-pdf';
import { toErrorResponse } from '@/server/http';

// GET /api/org/[id]/report.pdf?period=2026-06 — bilingual monthly report PDF with
// the founder authored-by line. Guarded: org_admin of this org, or owner/staff.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await requireOrgAccess(id);
    const period = req.nextUrl.searchParams.get('period')?.trim() || defaultPeriod();

    const report = await generateOrgReport(id, period);
    const pdf = await renderReportPdf(report);

    return new NextResponse(pdf as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="report-${period}.pdf"`,
        'Content-Length': String(pdf.length),
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

function defaultPeriod(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}
