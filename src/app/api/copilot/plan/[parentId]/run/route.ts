import { NextResponse } from 'next/server';
import { requireRole, STAFF_ROLES } from '@/server/auth/rbac';
import { runPlan } from '@/server/ai/orchestrator';
import { toErrorResponse } from '@/server/http';

/**
 * Executes a proposed plan dependency-aware: every runnable `auto` step runs
 * now; `approve`/`owner` steps stay queued for the approval endpoint; steps
 * still waiting on an unexecuted dependency stay pending. Approving an
 * individual step (via /api/approvals/[id]/approve) resumes the plan.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ parentId: string }> }) {
  try {
    const session = await requireRole(...STAFF_ROLES);
    const { parentId } = await params;
    const result = await runPlan(session, parentId);
    return NextResponse.json(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
