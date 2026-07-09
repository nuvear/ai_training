import 'server-only';
import type { Prisma } from '@/generated/prisma';
import { NotFoundError, InvalidStateError } from './errors';
import { evaluateCompletion, type CompletionStatus } from './completion';

// ─────────────────────────────────────────────────────────────────────────────
// Quiz attempt scoring (PRODUCT_SPEC §5). SERVER-SIDE ONLY: the client submits
// answers, never a score. score = correct / total × 100 (rounded);
// passed = score ≥ quiz.passPct. On a PASS we write ProgressEvent(quiz_passed)
// and re-evaluate completion (which auto-issues the certificate on first
// satisfaction). Only PUBLISHED quizzes are attemptable.
//
// Answers are untrusted DATA: each answer is compared to the stored correctKey;
// no answer value is ever executed or interpreted.
// ─────────────────────────────────────────────────────────────────────────────

export interface AttemptResult {
  attemptId: string;
  scorePct: number;
  passed: boolean;
  correct: number;
  total: number;
  completion: CompletionStatus;
}

/**
 * Score + persist a quiz attempt for an enrollment. Runs inside the caller's tx.
 * `answers` maps questionId → chosen option key.
 */
export async function scoreQuizAttempt(
  tx: Prisma.TransactionClient,
  args: { quizId: string; enrollmentId: string; answers: Record<string, string> },
): Promise<AttemptResult> {
  const quiz = await tx.quiz.findUnique({
    where: { id: args.quizId },
    include: { questions: { select: { id: true, correctKey: true } } },
  });
  if (!quiz) throw new NotFoundError('Quiz', args.quizId);
  if (quiz.status !== 'published') {
    throw new InvalidStateError('Quiz is not published');
  }
  if (quiz.questions.length === 0) {
    throw new InvalidStateError('Quiz has no questions');
  }

  const enrollment = await tx.enrollment.findUnique({
    where: { id: args.enrollmentId },
    select: { id: true },
  });
  if (!enrollment) throw new NotFoundError('Enrollment', args.enrollmentId);

  const total = quiz.questions.length;
  let correct = 0;
  for (const q of quiz.questions) {
    if (args.answers[q.id] === q.correctKey) correct += 1;
  }
  const scorePct = Math.round((correct / total) * 100);
  const passed = scorePct >= quiz.passPct;

  const attempt = await tx.quizAttempt.create({
    data: {
      enrollmentId: args.enrollmentId,
      quizId: args.quizId,
      answers: args.answers as unknown as Prisma.InputJsonValue,
      scorePct,
      passed,
    },
  });

  if (passed) {
    await tx.progressEvent.create({
      data: {
        enrollmentId: args.enrollmentId,
        kind: 'quiz_passed',
        payload: { quizId: args.quizId, scorePct },
      },
    });
  }

  const completion = await evaluateCompletion(tx, args.enrollmentId);

  return { attemptId: attempt.id, scorePct, passed, correct, total, completion };
}
