import { z } from 'zod';
import type { ToolDefinition } from '../types';
import { bilingualText } from '../i18n-content';
import { NotFoundError } from '@/server/domain/errors';
import { sendMail } from '@/server/email/send';

// Organizations & participants (COPILOT_TOOLS §5).

// ── org.create ───────────────────────────────────────────────────────────────
// approve-tier: creating a billing entity is a staff/owner action. Name is
// validated bilingual (invariant 1) so the org can never exist half-localized.

const createInput = z.object({
  name: bilingualText,
  billingEmail: z.string().trim().email().toLowerCase(),
  billingMethod: z.enum(['card', 'invoice_transfer']),
});
type CreateInput = z.infer<typeof createInput>;

export const orgCreate: ToolDefinition<CreateInput, { organizationId: string }> = {
  name: 'org.create',
  tier: 'approve',
  surfaces: ['copilot'],
  input: createInput,
  summarize: (i) => ({
    en: `Create organization “${i.name.en}”`,
    ja: `組織「${i.name.ja}」を作成`,
  }),
  handler: async (ctx, i) => {
    const org = await ctx.tx.organization.create({
      data: {
        name: { en: i.name.en, ja: i.name.ja },
        billingEmail: i.billingEmail,
        billingMethod: i.billingMethod,
      },
    });
    return { organizationId: org.id };
  },
};

// ── org.assign_seats ─────────────────────────────────────────────────────────
// auto-tier: invites employees onto an org's seat pool. For each email we upsert
// a `participant` User attached to the pool's org (email lowercased), then send a
// locale-aware invite (JA in 敬語/keigo for B2B). Seats are NOT consumed here —
// consumption happens at enrollment (participant.enroll org_seat). Only the pool's
// own org may be targeted.

const assignInput = z.object({
  seatPoolId: z.string().uuid(),
  userEmails: z.array(z.string().trim().email().toLowerCase()).min(1).max(200),
});
type AssignInput = z.infer<typeof assignInput>;

/** Locale-aware employee invite. JA uses 敬語 (B2B); EN is warm-professional. */
function inviteMail(email: string, orgName: string, locale: 'en' | 'ja') {
  if (locale === 'ja') {
    return {
      to: email,
      subject: `【WorkshopOS】${orgName}様よりワークショップへのご招待`,
      text: [
        `${orgName} 御中`,
        ``,
        `平素より大変お世話になっております。`,
        `この度、貴社を通じて WorkshopOS のワークショップにご招待申し上げます。`,
        `以下のメールアドレスにてアカウントをご用意しております。`,
        ``,
        `ログイン用メールアドレス：${email}`,
        ``,
        `ご不明な点がございましたら、お気軽にお問い合わせくださいませ。`,
        `何卒よろしくお願い申し上げます。`,
        ``,
        `WorkshopOS — ラジクマール・ラジャゴバラン`,
      ].join('\n'),
    };
  }
  return {
    to: email,
    subject: `You're invited to a WorkshopOS workshop by ${orgName}`,
    text: [
      `Hello,`,
      ``,
      `${orgName} has invited you to join a workshop on WorkshopOS.`,
      `An account has been prepared for you under this email address:`,
      ``,
      `Sign-in email: ${email}`,
      ``,
      `Sign in with your email to get started. If you have any questions, just reply to this message.`,
      ``,
      `WorkshopOS — Rajkumar Rajagobalan`,
    ].join('\n'),
  };
}

export const orgAssignSeats: ToolDefinition<AssignInput, { assignedUserIds: string[] }> = {
  name: 'org.assign_seats',
  tier: 'auto',
  surfaces: ['copilot'],
  input: assignInput,
  summarize: (i) => ({
    en: `Invite ${i.userEmails.length} employee(s) to seat pool ${i.seatPoolId.slice(0, 8)}`,
    ja: `シートプール ${i.seatPoolId.slice(0, 8)} に ${i.userEmails.length} 名の従業員を招待`,
  }),
  handler: async (ctx, i) => {
    const pool = await ctx.tx.seatPool.findUnique({
      where: { id: i.seatPoolId },
      include: { organization: true },
    });
    if (!pool) throw new NotFoundError('SeatPool', i.seatPoolId);

    const org = pool.organization;
    const orgNameJson = org.name as { en?: string; ja?: string };

    // Dedup the input emails (already lowercased by the schema transform).
    const emails = [...new Set(i.userEmails)];
    const assignedUserIds: string[] = [];

    for (const email of emails) {
      // Upsert a participant User bound to THIS pool's org (only the pool's org may
      // be targeted — we never accept a caller-supplied org id here).
      const existing = await ctx.tx.user.findUnique({ where: { email } });
      let userId: string;
      if (existing) {
        // Attach to the org if not already; keep their existing role otherwise.
        if (existing.organizationId !== org.id) {
          await ctx.tx.user.update({
            where: { id: existing.id },
            data: { organizationId: org.id },
          });
        }
        userId = existing.id;
      } else {
        const created = await ctx.tx.user.create({
          data: {
            email,
            role: 'participant',
            organizationId: org.id,
            locale: org.locale,
          },
        });
        userId = created.id;
      }
      assignedUserIds.push(userId);

      // Invite in the org's locale (敬語 for JA B2B).
      const orgLabel =
        org.locale === 'ja'
          ? (orgNameJson.ja ?? orgNameJson.en ?? '')
          : (orgNameJson.en ?? orgNameJson.ja ?? '');
      await sendMail(inviteMail(email, orgLabel ?? '', org.locale));
    }

    return { assignedUserIds };
  },
};
