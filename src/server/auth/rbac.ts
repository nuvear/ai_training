import 'server-only';
import { getSession, type SessionUser } from './session';
import type { Role } from '@/generated/prisma';

export { tenantContext } from '@/server/db/rls';

/** Thrown by the require* helpers; API routes map it to 401/403. */
export class AuthError extends Error {
  constructor(
    public status: 401 | 403,
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export async function requireSession(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) throw new AuthError(401, 'Not signed in');
  return session;
}

export async function requireRole(...allowed: Role[]): Promise<SessionUser> {
  const session = await requireSession();
  if (!allowed.includes(session.role)) {
    throw new AuthError(403, `Requires role: ${allowed.join(' | ')}`);
  }
  return session;
}

/** Roles that operate the copilot / approval surfaces. */
export const STAFF_ROLES: Role[] = ['owner', 'staff'];
