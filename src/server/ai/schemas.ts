import { z } from 'zod';

// Shared zod fragments for the workshop-domain tools (COPILOT_TOOLS §1–§2).

// A content field at authoring time: EN required, JA optional until localized.
export const bilingualDraft = z.object({
  en: z.string().trim().min(1, 'English text is required'),
  ja: z.string().trim().min(1).optional(),
});
export type BilingualDraft = z.infer<typeof bilingualDraft>;

export const levelEnum = z.enum(['intro', 'intermediate', 'advanced']);
export const cohortFormatEnum = z.enum(['online', 'in_person', 'hybrid']);
export const registerEnum = z.enum(['keigo_b2b', 'polite', 'casual']);
export const localeEnum = z.enum(['en', 'ja']);

/** Merge a bilingual patch into an existing stored value, per-locale. */
export function mergeBilingual(
  existing: unknown,
  patch: { en?: string; ja?: string } | undefined,
): { en?: string; ja?: string } {
  const base = (existing ?? {}) as { en?: string; ja?: string };
  if (!patch) return base;
  return {
    en: patch.en ?? base.en,
    ja: patch.ja ?? base.ja,
  };
}

/** url-safe slug from arbitrary text (used when a slug isn't supplied). */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60);
}
