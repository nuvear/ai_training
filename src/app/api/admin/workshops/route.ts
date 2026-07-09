import { NextResponse } from 'next/server';
import { requireRole, STAFF_ROLES } from '@/server/auth/rbac';
import { prisma } from '@/server/db/client';
import { toErrorResponse } from '@/server/http';

// Read-only admin listing: every workshop (any status) with its localization
// review state and cohorts, in a flat shape the admin client can render. Writes
// still go through /api/tools/execute — this route never mutates.
export async function GET() {
  try {
    await requireRole(...STAFF_ROLES);
    const workshops = await prisma.workshop.findMany({
      orderBy: { updatedAt: 'desc' },
      include: {
        cohorts: { orderBy: { startsAt: 'asc' } },
      },
    });

    return NextResponse.json({
      workshops: workshops.map((w) => ({
        id: w.id,
        slug: w.slug,
        title: w.title as { en?: string; ja?: string },
        summary: w.summary as { en?: string; ja?: string },
        description: w.description as { en?: string; ja?: string },
        outcomes: w.outcomes as { en?: string; ja?: string },
        level: w.level,
        status: w.status,
        localizationReview: w.localizationReview as { en?: string; ja?: string },
        cohorts: w.cohorts.map((c) => ({
          id: c.id,
          status: c.status,
          startsAt: c.startsAt.toISOString(),
          endsAt: c.endsAt.toISOString(),
          capacity: c.capacity,
          priceJpy: c.priceJpy,
          priceUsd: c.priceUsd,
          format: c.format,
          venue: c.venue as { en?: string; ja?: string } | null,
        })),
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
