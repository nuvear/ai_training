import { NextResponse, type NextRequest } from 'next/server';
import { requireSession, STAFF_ROLES } from '@/server/auth/rbac';
import { prisma } from '@/server/db/client';
import { loadCertificatePdfData, renderCertificatePdf } from '@/server/pdf/certificate-pdf';
import { toErrorResponse } from '@/server/http';

// GET /api/certificates/[enrollmentId]/pdf?locale=en|ja — bilingual certificate
// PDF, rendered on demand. Guard: the owner of the enrollment, or staff/owner.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ enrollmentId: string }> },
) {
  try {
    const { enrollmentId } = await params;
    const session = await requireSession();

    const enrollment = await prisma.enrollment.findUnique({
      where: { id: enrollmentId },
      select: { userId: true },
    });
    if (!enrollment) {
      return NextResponse.json({ error: 'Enrollment not found' }, { status: 404 });
    }
    const isStaff = STAFF_ROLES.includes(session.role);
    if (!isStaff && enrollment.userId !== session.userId) {
      return NextResponse.json({ error: 'Not your certificate' }, { status: 403 });
    }

    const localeParam = req.nextUrl.searchParams.get('locale');
    const locale: 'en' | 'ja' = localeParam === 'ja' ? 'ja' : 'en';

    // Base client read is fine — the route guard already authorized this user.
    const data = await loadCertificatePdfData(prisma, enrollmentId);
    const pdf = await renderCertificatePdf(data, locale);

    return new NextResponse(pdf as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="certificate-${data.verifyCode}.pdf"`,
        'Content-Length': String(pdf.length),
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
