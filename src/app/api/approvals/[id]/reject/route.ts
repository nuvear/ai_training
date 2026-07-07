import { NextResponse } from 'next/server';
import { requireRole, STAFF_ROLES } from '@/server/auth/rbac';
import { rejectAction } from '@/server/ai/ledger';
import { toErrorResponse } from '@/server/http';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole(...STAFF_ROLES);
    const { id } = await params;
    const action = await rejectAction(session, id);
    return NextResponse.json({ id: action.id, status: action.status });
  } catch (err) {
    return toErrorResponse(err);
  }
}
