import { z } from 'zod';
import type { ToolDefinition } from '../types';

// The M0 toy tool. It is `approve`-tier on purpose so the end-to-end approval
// flow (propose → approve → execute → ledger) is exercised. Its output is
// bilingual, demonstrating that even trivial tool output carries both locales.
const input = z.object({
  message: z.string().trim().min(1).max(280).optional(),
});

type PingInput = z.infer<typeof input>;

const DEFAULT_MESSAGE = 'ping';

export interface PingOutput {
  pong: { en: string; ja: string };
  echoed: string;
  at: string;
}

export const workshopPing: ToolDefinition<PingInput, PingOutput> = {
  name: 'workshop.ping',
  tier: 'approve',
  surfaces: ['copilot'],
  input,
  summarize: (i) => {
    const message = i.message ?? DEFAULT_MESSAGE;
    return {
      en: `Ping the workshop system with "${message}"`,
      ja: `ワークショップシステムに「${message}」で ping を送る`,
    };
  },
  handler: async (_ctx, i) => {
    const message = i.message ?? DEFAULT_MESSAGE;
    return {
      pong: {
        en: `Pong: ${message}`,
        ja: `ポン：${message}`,
      },
      echoed: message,
      // Timestamp is produced server-side at execution time.
      at: new Date().toISOString(),
    };
  },
};
