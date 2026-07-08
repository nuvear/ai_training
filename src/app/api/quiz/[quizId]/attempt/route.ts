import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireSession, STAFF_ROLES } from '@/server/auth/rbac';
import { prisma } from '@/server/db/client';
import { withOrgContext } from '@/server/db/rls';
import { scoreQuizAttempt } from '@/server/domain/quiz-attempt';
import { toErrorResponse } from '@/server/http';

// POST /api/quiz/[quizId]/attempt — submit a participant quiz attempt.
// Body: { enrollmentId, answers: { questionId: optionKey } }.
// Guard: the enrollment's user == the signed-in user, OR staff/owner.
// Scoring + completion re-eval are SERVER-SIDE only.
const body = z.object({
  enrollmentId: z.string().uuid(),
  answers: z.record(z.string()),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ quizId: string }> }) {
  try {
    const { quizId } = await params;
    const session = await requireSession();

    const parsed = body.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'enrollmentId and answers are required' }, { status: 400 });
    }

    // Ownership guard at the route layer: staff may score anyone; a participant
    // may only submit for their own enrollment.
    const enrollment = await prisma.enrollment.findUnique({
      where: { id: parsed.data.enrollmentId },
      select: { userId: true },
    });
    if (!enrollment) {
      return NextResponse.json({ error: 'Enrollment not found' }, { status: 404 });
    }
    const isStaff = STAFF_ROLES.includes(session.role);
    if (!isStaff && enrollment.userId !== session.userId) {
      return NextResponse.json({ error: 'Not your enrollment' }, { status: 403 });
    }

    // Score under an owner-level, self-scoped context: scoring re-evaluates
    // completion which reads cohort sessions + issues the certificate (crosses
    // the enrollment boundary), same elevated-but-scoped pattern as fulfillment.
    const result = await withOrgContext(
      { userId: '00000000-0000-0000-0000-000000000000', role: 'owner', organizationId: null },
      (tx) =>
        scoreQuizAttempt(tx, {
          quizId,
          enrollmentId: parsed.data.enrollmentId,
          answers: parsed.data.answers,
        }),
    );

    return NextResponse.json({
      attemptId: result.attemptId,
      scorePct: result.scorePct,
      passed: result.passed,
      correct: result.correct,
      total: result.total,
      completed: result.completion.completed,
      justCompleted: result.completion.justCompleted,
      certificateId: result.completion.certificateId,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
