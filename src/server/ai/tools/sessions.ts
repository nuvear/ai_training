import { z } from 'zod';
import type { ToolDefinition } from '../types';
import { NotFoundError } from '@/server/domain/errors';

const updateAgendaInput = z.object({
  sessionId: z.string().uuid(),
  agenda: z.object({ en: z.string(), ja: z.string() }).partial(),
});
type UpdateAgendaInput = z.infer<typeof updateAgendaInput>;

export const sessionUpdateAgenda: ToolDefinition<UpdateAgendaInput, { sessionId: string }> = {
  name: 'session.update_agenda',
  tier: 'auto',
  surfaces: ['copilot'],
  input: updateAgendaInput,
  summarize: (i) => ({
    en: `Update agenda for session ${i.sessionId.slice(0, 8)}`,
    ja: `セッション ${i.sessionId.slice(0, 8)} のアジェンダを更新`,
  }),
  handler: async (ctx, i) => {
    const session = await ctx.tx.session.findUnique({ where: { id: i.sessionId } });
    if (!session) throw new NotFoundError('Session', i.sessionId);
    const agenda = { ...((session.agenda ?? {}) as object), ...i.agenda };
    await ctx.tx.session.update({ where: { id: i.sessionId }, data: { agenda } });
    return { sessionId: i.sessionId };
  },
};
