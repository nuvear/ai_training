import { NextResponse } from 'next/server';
import { requireRole, STAFF_ROLES } from '@/server/auth/rbac';
import { getAiLayerMetrics } from '@/server/observability/metrics';
import { toErrorResponse } from '@/server/http';

// GET /api/admin/metrics — staff-only AI-layer observability (M6 §4). Returns the
// computed metrics object (approval/override rates, auto share, latency, tier &
// status counts) for the ops dashboard. Read-only; owner/staff only.
export async function GET() {
  try {
    await requireRole(...STAFF_ROLES);
    const metrics = await getAiLayerMetrics();
    return NextResponse.json(metrics);
  } catch (err) {
    return toErrorResponse(err);
  }
}
