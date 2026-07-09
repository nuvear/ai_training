import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/server/db/client';
import { requireOrgAccess } from '@/server/auth/org-access';
import { withOrgContext, tenantContext } from '@/server/db/rls';
import { loadInvoicePdfData, renderInvoicePdf } from '@/server/pdf/invoice-pdf';
import { toErrorResponse } from '@/server/http';

// GET /api/invoices/[id]/pdf — bilingual 請求書 PDF, rendered on demand. Guarded:
// org_admin of the invoice's org, or owner/staff. We resolve the invoice's org
// first (to run the access check), then load + render inside the caller's tenant
// context so RLS re-scopes the read.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      select: { organizationId: true, number: true },
    });
    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    const session = await requireOrgAccess(invoice.organizationId);
    const data = await withOrgContext(tenantContext(session), (tx) => loadInvoicePdfData(tx, id));
    const pdf = await renderInvoicePdf(data);

    return new NextResponse(pdf as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${invoice.number}.pdf"`,
        'Content-Length': String(pdf.length),
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
