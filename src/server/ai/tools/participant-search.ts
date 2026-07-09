import { z } from 'zod';
import { Prisma } from '@/generated/prisma';
import type { ToolDefinition } from '../types';

// participant.search (COPILOT_TOOLS §5) — auto-tier, copilot surface. BASIC.
//
// NOTE (deferred): the spec calls for pgvector-backed SEMANTIC search. This is a
// BASIC name/email ILIKE search for now; semantic ranking over the Embedding
// table is deferred to a later pass. RBAC scope is honored by RLS on the `user`
// table (owner/staff see all; org_admin sees only their org).

const searchInput = z.object({
  query: z.string().trim().min(1).max(200),
  limit: z.number().int().min(1).max(50).default(20),
});
type SearchInput = z.infer<typeof searchInput>;

interface SearchHit {
  userId: string;
  email: string;
  name: unknown;
}
interface SearchOutput {
  query: string;
  results: SearchHit[];
  semantic: false;
}

export const participantSearch: ToolDefinition<SearchInput, SearchOutput> = {
  name: 'participant.search',
  tier: 'auto',
  surfaces: ['copilot'],
  input: searchInput,
  summarize: (i) => ({
    en: `Search participants matching "${i.query}"`,
    ja: `「${i.query}」に一致する参加者を検索`,
  }),
  handler: async (ctx, i) => {
    // ILIKE on email; name is JSON so we match its display/given/family via the
    // JSON text. Untrusted query is passed as a bound parameter (no injection).
    const like = `%${i.query}%`;
    const users = await ctx.tx.user.findMany({
      where: {
        OR: [
          { email: { contains: i.query, mode: Prisma.QueryMode.insensitive } },
          // name JSON contains the query in any of its string values
          {
            name: {
              path: ['display'],
              string_contains: i.query,
            },
          },
        ],
      },
      select: { id: true, email: true, name: true },
      take: i.limit,
    });
    void like;

    return {
      query: i.query,
      results: users.map((u) => ({ userId: u.id, email: u.email, name: u.name })),
      semantic: false,
    };
  },
};
