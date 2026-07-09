import { NextResponse } from 'next/server';
import { requireRole, STAFF_ROLES } from '@/server/auth/rbac';
import { listProposed } from '@/server/ai/ledger';
import { getTool } from '@/server/ai/registry';
import { toErrorResponse } from '@/server/http';

export async function GET() {
  try {
    await requireRole(...STAFF_ROLES);
    const actions = await listProposed();
    return NextResponse.json({
      actions: actions.map((a) => ({
        id: a.id,
        toolName: a.toolName,
        tier: a.tier,
        status: a.status,
        createdAt: a.createdAt.toISOString(),
        summary: getTool(a.toolName).summarize(a.input),
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
