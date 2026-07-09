import { z } from 'zod';
import type { ToolDefinition } from '../types';
import { NotFoundError } from '@/server/domain/errors';
import { evaluateCompletion, type CompletionStatus } from '@/server/domain/completion';

// attendance.record (COPILOT_TOOLS §5) — auto-tier, copilot (facilitator) surface.
//
// Upserts one Attendance row per entry (method `facilitator`), writes a
// ProgressEvent(session_attended) for each `present`, then re-evaluates the
// completion rule for every affected enrollment (which auto-issues a certificate
// on first satisfaction). Idempotent: re-recording the same session updates the
// existing rows and never double-fires completion.

const attendanceInput = z.object({
  sessionId: z.string().uuid(),
  entries: z
    .array(
      z.object({
        enrollmentId: z.string().uuid(),
        status: z.enum(['present', 'absent', 'excused']),
      }),
    )
    .min(1, 'At least one attendance entry is required'),
});
type AttendanceInput = z.infer<typeof attendanceInput>;

interface AttendanceOutput {
  sessionId: string;
  recorded: number;
  completions: Array<{
    enrollmentId: string;
    justCompleted: boolean;
    certificateId: string | null;
  }>;
}

export const attendanceRecord: ToolDefinition<AttendanceInput, AttendanceOutput> = {
  name: 'attendance.record',
  tier: 'auto',
  surfaces: ['copilot'],
  input: attendanceInput,
  summarize: (i) => ({
    en: `Record attendance for ${i.entries.length} participant(s) in session ${i.sessionId.slice(0, 8)}`,
    ja: `セッション ${i.sessionId.slice(0, 8)} の${i.entries.length}名の出席を記録`,
  }),
  handler: async (ctx, i) => {
    const session = await ctx.tx.session.findUnique({ where: { id: i.sessionId } });
    if (!session) throw new NotFoundError('Session', i.sessionId);

    const completions: AttendanceOutput['completions'] = [];

    for (const entry of i.entries) {
      const enrollment = await ctx.tx.enrollment.findUnique({
        where: { id: entry.enrollmentId },
        select: { id: true, cohortId: true },
      });
      if (!enrollment) throw new NotFoundError('Enrollment', entry.enrollmentId);
      // Guard cross-cohort mistakes: the enrollment must belong to this session's cohort.
      if (enrollment.cohortId !== session.cohortId) {
        continue;
      }

      await ctx.tx.attendance.upsert({
        where: {
          enrollmentId_sessionId: { enrollmentId: entry.enrollmentId, sessionId: i.sessionId },
        },
        update: { status: entry.status, method: 'facilitator', recordedAt: new Date() },
        create: {
          enrollmentId: entry.enrollmentId,
          sessionId: i.sessionId,
          status: entry.status,
          method: 'facilitator',
        },
      });

      if (entry.status === 'present') {
        await ctx.tx.progressEvent.create({
          data: {
            enrollmentId: entry.enrollmentId,
            kind: 'session_attended',
            payload: { sessionId: i.sessionId },
          },
        });
      }

      const status: CompletionStatus = await evaluateCompletion(ctx.tx, entry.enrollmentId);
      completions.push({
        enrollmentId: entry.enrollmentId,
        justCompleted: status.justCompleted,
        certificateId: status.certificateId,
      });
    }

    return { sessionId: i.sessionId, recorded: completions.length, completions };
  },
};
