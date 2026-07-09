import { Prisma } from '@/generated/prisma';
import { prisma } from './client';
import type { Role } from '@/generated/prisma';

export interface TenantContext {
  userId: string;
  role: Role;
  /** null for owner/staff or individuals not attached to an org */
  organizationId: string | null;
}

/**
 * Runs `fn` inside a transaction that:
 *   1. stores the caller's identity in `app.current_*` GUCs, and
 *   2. `SET LOCAL ROLE`s to the non-superuser `workshopos_app` role,
 * which subjects the queries to the row-level-security policies (see the
 * rls_grants_guards migration). This is the ONLY sanctioned way to read/write
 * org-scoped tables on behalf of a user.
 *
 * The config values are UUIDs / enum strings from the trusted session, never
 * raw user input, and they are passed as bound parameters regardless.
 */
export async function withOrgContext<T>(
  ctx: TenantContext,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_user_id', ${ctx.userId}, true)`;
    await tx.$executeRaw`SELECT set_config('app.current_org_id', ${ctx.organizationId ?? ''}, true)`;
    await tx.$executeRaw`SELECT set_config('app.current_role', ${ctx.role}, true)`;
    // SET LOCAL ROLE only accepts an identifier, not a bind param. The role name
    // is a fixed constant, so there is no injection surface here.
    await tx.$executeRawUnsafe('SET LOCAL ROLE workshopos_app');
    return fn(tx);
  });
}

/** Narrows a session down to the tenant fields RLS needs. Lives here (not in
 * auth/) so server modules can build a context without importing next/headers. */
export function tenantContext(session: {
  userId: string;
  role: Role;
  organizationId: string | null;
}): TenantContext {
  return {
    userId: session.userId,
    role: session.role,
    organizationId: session.organizationId,
  };
}
