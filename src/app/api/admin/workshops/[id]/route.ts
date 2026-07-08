import { NextResponse, type NextRequest } from 'next/server';
import { requireRole, STAFF_ROLES } from '@/server/auth/rbac';
import { prisma } from '@/server/db/client';
import { toErrorResponse } from '@/server/http';

// Read-only: a single workshop with cohorts and skills, for the editor. Mutations
// go through /api/tools/execute.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole(...STAFF_ROLES);
    const { id } = await params;
    const w = await prisma.workshop.findUnique({
      where: { id },
      include: {
        cohorts: { orderBy: { startsAt: 'asc' } },
        skills: { include: { skill: true } },
      },
    });
    if (!w) {
      return NextResponse.json({ error: 'Workshop not found' }, { status: 404 });
    }

    return NextResponse.json({
      workshop: {
        id: w.id,
        slug: w.slug,
        title: w.title as { en?: string; ja?: string },
        summary: w.summary as { en?: string; ja?: string },
        description: w.description as { en?: string; ja?: string },
        outcomes: w.outcomes as { en?: string; ja?: string },
        level: w.level,
        status: w.status,
        localizationReview: w.localizationReview as { en?: string; ja?: string },
        skills: w.skills.map((s) => s.skill.slug),
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
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
