import { NextResponse, type NextRequest } from 'next/server';
import { requireSession } from '@/server/auth/rbac';
import { prisma } from '@/server/db/client';
import { evaluateCompletionElevated } from '@/server/domain/completion';
import { toErrorResponse } from '@/server/http';

// GET /api/checkin/[token] — participant self check-in (COPILOT_TOOLS §5 /
// PRODUCT_SPEC §5). The session carries a `checkinToken`; the SIGNED-IN
// participant is marked `present` for that session (method `self_checkin`), then
// their completion is re-evaluated (which auto-issues a certificate on the first
// satisfaction). Idempotent — a second click keeps them present, no double event.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const session = await requireSession();

    const workshopSession = await prisma.session.findFirst({
      where: { checkinToken: token },
      select: { id: true, cohortId: true },
    });
    if (!workshopSession) {
      return NextResponse.json({ error: 'Invalid check-in link' }, { status: 404 });
    }

    // The participant must be enrolled in THIS session's cohort.
    const enrollment = await prisma.enrollment.findUnique({
      where: { userId_cohortId: { userId: session.userId, cohortId: workshopSession.cohortId } },
      select: { id: true },
    });
    if (!enrollment) {
      return NextResponse.json({ error: 'You are not enrolled in this cohort' }, { status: 403 });
    }

    // Only create a session_attended event if this is a NEW present mark, so a
    // repeated click does not inflate the progress stream.
    const existing = await prisma.attendance.findUnique({
      where: {
        enrollmentId_sessionId: {
          enrollmentId: enrollment.id,
          sessionId: workshopSession.id,
        },
      },
      select: { status: true },
    });
    const wasPresent = existing?.status === 'present';

    await prisma.attendance.upsert({
      where: {
        enrollmentId_sessionId: {
          enrollmentId: enrollment.id,
          sessionId: workshopSession.id,
        },
      },
      update: { status: 'present', method: 'self_checkin', recordedAt: new Date() },
      create: {
        enrollmentId: enrollment.id,
        sessionId: workshopSession.id,
        status: 'present',
        method: 'self_checkin',
      },
    });

    if (!wasPresent) {
      await prisma.progressEvent.create({
        data: {
          enrollmentId: enrollment.id,
          kind: 'session_attended',
          payload: { sessionId: workshopSession.id, method: 'self_checkin' },
        },
      });
    }

    const status = await evaluateCompletionElevated(enrollment.id);

    return NextResponse.json({
      checkedIn: true,
      sessionId: workshopSession.id,
      completed: status.completed,
      justCompleted: status.justCompleted,
      certificateId: status.certificateId,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
