import 'server-only';
import { AuthError } from './rbac';
import { requireSession } from './rbac';
import type { SessionUser } from './session';

// ─────────────────────────────────────────────────────────────────────────────
// Org-scoped read guard for the M3 org-portal routes. Owner/staff may read any
// org; an org_admin may read ONLY their own org. Everyone else is forbidden. This
// is the route-layer gate that sits in front of the RLS-scoped queries.
// ─────────────────────────────────────────────────────────────────────────────

export async function requireOrgAccess(organizationId: string): Promise<SessionUser> {
  const session = await requireSession();
  if (session.role === 'owner' || session.role === 'staff') return session;
  if (session.role === 'org_admin' && session.organizationId === organizationId) return session;
  throw new AuthError(403, 'You do not have access to this organization');
}
