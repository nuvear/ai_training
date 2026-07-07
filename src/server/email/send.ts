import 'server-only';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

/**
 * Sends transactional mail via Resend when RESEND_API_KEY is configured.
 * In dev/test (no key) it logs to the server console and returns the body so
 * callers can surface a dev link — no mail server needed to sign in locally.
 */
export async function sendMail(mail: Mail): Promise<{ delivered: 'resend' | 'console' }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.info(`[mail:console] to=${mail.to} subject="${mail.subject}"\n${mail.text}`);
    return { delivered: 'console' };
  }

  const { Resend } = await import('resend');
  const resend = new Resend(apiKey);
  await resend.emails.send({
    from: process.env.EMAIL_FROM ?? 'WorkshopOS <login@workshopos.local>',
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
  });
  return { delivered: 'resend' };
}

export function isMailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}
