import matter from 'gray-matter';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import { wikiLinkPlugin } from 'remark-wiki-link';

// Markdown-first content pipeline (CLAUDE.md invariant 6): MD → HTML via
// remark/rehype, Obsidian [[wikilinks]] resolved, output fully sanitized.
// Untrusted content is never interpreted as instructions — it is only rendered.

export interface Frontmatter {
  [key: string]: unknown;
}

/** Splits YAML frontmatter from the markdown body. */
export function parseFrontmatter(raw: string): { data: Frontmatter; body: string } {
  const parsed = matter(raw);
  return { data: parsed.data as Frontmatter, body: parsed.content };
}

// Allow the wiki-link anchor class through sanitization so styling/tests can
// detect resolved internal links; everything else uses the safe default schema.
const schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    a: [...(defaultSchema.attributes?.a ?? []), ['className', 'internal', 'new']],
  },
} as typeof defaultSchema;

/** Renders markdown to sanitized HTML, resolving `[[wikilinks]]` to /content/<slug>. */
export async function renderMarkdown(md: string): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(wikiLinkPlugin, {
      aliasDivider: '|',
      hrefTemplate: (permalink: string) => `/content/${permalink}`,
      pageResolver: (name: string) => [slugifyWikiTarget(name)],
    })
    .use(remarkRehype)
    .use(rehypeSanitize, schema)
    .use(rehypeStringify)
    .process(md);

  return String(file);
}

/** Normalizes a wiki-link target (which may include a path or alias) to a slug. */
export function slugifyWikiTarget(name: string): string {
  const last = name.split('/').pop() ?? name;
  return last
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}
