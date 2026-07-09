import { z } from 'zod';
import type { ToolDefinition } from '../types';
import { NotFoundError } from '@/server/domain/errors';
import { ensureCertificate } from '@/server/domain/completion';

// certificate.issue (COPILOT_TOOLS §5) — auto-tier, copilot surface.
//
// Normally fires automatically from the completion rule (see completion.ts). This
// tool is the MANUAL re-issue / explicit-issue path. Idempotent — one certificate
// per enrollment via the unique constraint; a re-run returns the existing row.

const issueInput = z.object({ enrollmentId: z.string().uuid() });
type IssueInput = z.infer<typeof issueInput>;

interface IssueOutput {
  certificateId: string;
  enrollmentId: string;
}

export const certificateIssue: ToolDefinition<IssueInput, IssueOutput> = {
  name: 'certificate.issue',
  tier: 'auto',
  surfaces: ['copilot'],
  input: issueInput,
  summarize: (i) => ({
    en: `Issue certificate for enrollment ${i.enrollmentId.slice(0, 8)}`,
    ja: `登録 ${i.enrollmentId.slice(0, 8)} の修了証を発行`,
  }),
  handler: async (ctx, i) => {
    const enrollment = await ctx.tx.enrollment.findUnique({
      where: { id: i.enrollmentId },
      select: { id: true },
    });
    if (!enrollment) throw new NotFoundError('Enrollment', i.enrollmentId);

    const certificateId = await ensureCertificate(ctx.tx, i.enrollmentId);
    return { certificateId, enrollmentId: i.enrollmentId };
  },
};
