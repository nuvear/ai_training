import { z } from 'zod';
import type { ToolDefinition } from '../types';
import { NotFoundError } from '@/server/domain/errors';
import { sendMail } from '@/server/email/send';

// nudge.send (COPILOT_TOOLS §5) — auto-tier, copilot surface. BASIC.
//
// Sends a bilingual, substitution-safe reminder to a participant, respecting
// user.notificationPrefs mute flags, and writes ProgressEvent(nudge_sent).
// Substitution-safe: the template only interpolates trusted fields (workshop
// title, session date) — never free-form participant input — so untrusted content
// can never alter the message structure.

const nudgeInput = z.object({
  enrollmentId: z.string().uuid(),
  kind: z.enum(['prework', 'session_tomorrow', 'quiz_pending']),
});
type NudgeInput = z.infer<typeof nudgeInput>;

interface NudgeOutput {
  enrollmentId: string;
  kind: NudgeInput['kind'];
  sent: boolean;
  reason?: 'muted';
}

// Fixed bilingual templates keyed by kind. `{title}` is the only substitution and
// is a trusted, admin-authored workshop title.
const TEMPLATES: Record<NudgeInput['kind'], { subject: string; en: string; ja: string }> = {
  prework: {
    subject: 'WorkshopOS — Pre-work reminder / 事前課題のリマインド',
    en: 'A friendly reminder to complete the pre-work for "{title}" before your next session.',
    ja: '「{title}」の次回セッション前に、事前課題の完了をお願いいたします。',
  },
  session_tomorrow: {
    subject: 'WorkshopOS — Session tomorrow / 明日のセッション',
    en: 'Your "{title}" session is tomorrow. We look forward to seeing you.',
    ja: '「{title}」のセッションは明日です。お会いできることを楽しみにしております。',
  },
  quiz_pending: {
    subject: 'WorkshopOS — Quiz pending / クイズのご案内',
    en: 'You have a pending quiz for "{title}". Completing it moves you toward your certificate.',
    ja: '「{title}」のクイズが未完了です。完了すると修了証の取得に近づきます。',
  },
};

/** Read a boolean mute flag out of the untrusted notificationPrefs JSON. */
function isMuted(prefs: unknown, kind: string): boolean {
  const p = (prefs ?? {}) as Record<string, unknown>;
  if (p.muteAll === true) return true;
  const mutedKinds = p.mutedKinds;
  if (Array.isArray(mutedKinds) && mutedKinds.includes(kind)) return true;
  const nudges = p.nudges as Record<string, unknown> | undefined;
  if (nudges && nudges[kind] === false) return true;
  return false;
}

export const nudgeSend: ToolDefinition<NudgeInput, NudgeOutput> = {
  name: 'nudge.send',
  tier: 'auto',
  surfaces: ['copilot'],
  input: nudgeInput,
  summarize: (i) => ({
    en: `Send ${i.kind} nudge for enrollment ${i.enrollmentId.slice(0, 8)}`,
    ja: `登録 ${i.enrollmentId.slice(0, 8)} に${i.kind}リマインドを送信`,
  }),
  handler: async (ctx, i) => {
    const enrollment = await ctx.tx.enrollment.findUnique({
      where: { id: i.enrollmentId },
      include: { user: true, cohort: { include: { workshop: true } } },
    });
    if (!enrollment) throw new NotFoundError('Enrollment', i.enrollmentId);

    if (isMuted(enrollment.user.notificationPrefs, i.kind)) {
      return { enrollmentId: i.enrollmentId, kind: i.kind, sent: false, reason: 'muted' };
    }

    const title = enrollment.cohort.workshop.title as { en?: string; ja?: string };
    const tpl = TEMPLATES[i.kind];
    const enBody = tpl.en.replace('{title}', title.en ?? '');
    const jaBody = tpl.ja.replace('{title}', title.ja ?? '');

    await sendMail({
      to: enrollment.user.email,
      subject: tpl.subject,
      text: `${enBody}\n\n— — —\n\n${jaBody}`,
    });

    await ctx.tx.progressEvent.create({
      data: { enrollmentId: i.enrollmentId, kind: 'nudge_sent', payload: { kind: i.kind } },
    });

    return { enrollmentId: i.enrollmentId, kind: i.kind, sent: true };
  },
};
