import { z } from 'zod';
import type { Locale } from '@/generated/prisma';

export const LOCALES: Locale[] = ['en', 'ja'];

/**
 * A bilingual content value. Both locales must be non-empty. This is the schema
 * form of CLAUDE.md invariant 1 ("no entity leaves draft without both locales")
 * — tools and API routes validate content through here, not just the UI.
 */
export const bilingualText = z.object({
  en: z.string().trim().min(1, 'English text is required'),
  ja: z.string().trim().min(1, '日本語のテキストが必要です'),
});

export type BilingualText = z.infer<typeof bilingualText>;

/**
 * True only when both locales are present and non-empty. Used at the publish
 * gate for any entity leaving draft/AI-draft status.
 */
export function isBilingualComplete(value: unknown): value is BilingualText {
  return bilingualText.safeParse(value).success;
}

export function assertBilingualComplete(value: unknown): asserts value is BilingualText {
  bilingualText.parse(value);
}
