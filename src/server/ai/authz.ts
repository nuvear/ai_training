import type { Role } from '@/generated/prisma';
import { STAFF_ROLES } from '@/server/auth/rbac';

/**
 * Copilot tools are staff-only, EXCEPT this allowlist of org-scoped tools an
 * org_admin may drive from the org portal. RLS still confines them to their own
 * org (e.g. org.assign_seats can only resolve a seat pool in the caller's org).
 *
 * Lives here (not in the route module) because Next.js route files may only
 * export route handlers; the authz-matrix test and the route both import it, so
 * there is a SINGLE source of the allowlist.
 */
export const ORG_ADMIN_TOOLS = new Set<string>(['org.assign_seats']);

/** The roles permitted to INVOKE a copilot tool via /api/tools/execute. */
export function allowedInvokeRoles(toolName: string): Role[] {
  return ORG_ADMIN_TOOLS.has(toolName) ? [...STAFF_ROLES, 'org_admin'] : STAFF_ROLES;
}
