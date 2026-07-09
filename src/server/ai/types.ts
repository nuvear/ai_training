import type { z } from 'zod';
import type { Prisma, AiSurface, AiTier } from '@/generated/prisma';
import type { SessionUser } from '@/server/auth/session';
import type { BilingualText } from './i18n-content';

export type Surface = AiSurface; // 'copilot' | 'concierge' | 'scheduler'
export type Tier = AiTier; // 'auto' | 'approve' | 'owner_only'

/** Execution context handed to a tool handler; `tx` already runs inside the
 * caller's tenant RLS context. */
export interface ToolContext {
  session: SessionUser;
  tx: Prisma.TransactionClient;
  /** The ledger row id for THIS execution. Handlers that persist a link back to
   * the ledger (e.g. refund.execute → refund.ai_action_id) use it. */
  actionId: string;
}

export interface ToolDefinition<I = unknown, O = unknown> {
  name: string;
  /** Server-side tier — the single source of truth. Model output cannot change
   * this (CLAUDE.md invariant 2 / COPILOT_TOOLS §cross-cutting 1). */
  tier: Tier;
  /** Surfaces permitted to call this tool. The public concierge is limited to a
   * narrow subset (invariant 7). */
  surfaces: Surface[];
  // Third type param is `any` so schemas with .default()/.refine() (whose input
  // type differs from their output) still satisfy the contract — only the parsed
  // OUTPUT type `I` is load-bearing.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input: z.ZodType<I, z.ZodTypeDef, any>;
  handler: (ctx: ToolContext, input: I) => Promise<O>;
  /** Bilingual one-line description shown in the plan preview. */
  summarize: (input: I) => BilingualText;
  /**
   * Optional per-call tier override, computed SERVER-SIDE from the parsed input
   * (e.g. `refund.execute` is `approve` ≤ ¥10,000, `owner_only` above). Still
   * server-authoritative: the ledger stores `dynamicTier(input) ?? tier`, and the
   * approval gate recomputes it the same way from the stored input, so a caller
   * cannot escalate or de-escalate their own permission. When absent, `tier` is
   * the fixed tier for every call.
   */
  dynamicTier?: (input: I) => Tier;
}
