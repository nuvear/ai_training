import { prisma } from '@/server/db/client';

// Public catalog reads. Workshops are global business data (not org-scoped), so
// these run without a tenant context and only surface `published` rows.

export async function listPublishedWorkshops() {
  return prisma.workshop.findMany({
    where: { status: 'published' },
    include: {
      skills: { include: { skill: true } },
      cohorts: {
        where: { status: { in: ['open', 'full'] } },
        orderBy: { startsAt: 'asc' },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getPublishedWorkshopBySlug(slug: string) {
  return prisma.workshop.findFirst({
    where: { slug, status: 'published' },
    include: {
      skills: { include: { skill: true } },
      cohorts: { orderBy: { startsAt: 'asc' } },
    },
  });
}

export type CatalogWorkshop = Awaited<ReturnType<typeof listPublishedWorkshops>>[number];
