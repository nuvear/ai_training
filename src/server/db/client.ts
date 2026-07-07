import { PrismaClient } from '@/generated/prisma';

// Single PrismaClient across hot-reloads in dev. Connects as the DATABASE_URL
// role (a superuser in dev). Tenant queries must go through withOrgContext()
// in ./rls.ts so row-level security is actually enforced.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
