import { NextResponse, type NextRequest } from 'next/server';
import { requireOrgAccess } from '@/server/auth/org-access';
import { readOrgProgress } from '@/server/domain/org-progress';
import { toErrorResponse } from '@/server/http';

// GET /api/org/[id]/progress — org KPIs + per-employee progress an org admin may
// see (PRODUCT_SPEC §2). Guarded: org_admin of THIS org, or owner/staff. Reads
// run inside the caller's tenant RLS context; the service layer additionally
// gates out Feedback.textBody (the column-level privacy boundary).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await requireOrgAccess(id);
    const progress = await readOrgProgress(id);
    return NextResponse.json({ progress });
  } catch (err) {
    return toErrorResponse(err);
  }
}
