import { describe, it, expect } from 'vitest';
import { parseFrontmatter, renderMarkdown, slugifyWikiTarget } from '@/server/content/markdown';

// CLAUDE.md invariant 6: MD→HTML with remark-wiki-link + full sanitization;
// invariant 7: rendered content is data, never executed.
describe('markdown content pipeline', () => {
  it('parses YAML frontmatter from the body', () => {
    const { data, body } = parseFrontmatter(
      '---\ntitle:\n  en: Hello\n  ja: こんにちは\n---\n\n# Body\n',
    );
    expect((data.title as { en: string }).en).toBe('Hello');
    expect(body.trim()).toBe('# Body');
  });

  it('resolves Obsidian [[wikilinks]] to /content/<slug> anchors', async () => {
    const html = await renderMarkdown('See [[facilitator-script]] for details.');
    expect(html).toContain('href="/content/facilitator-script"');
    const aliased = await renderMarkdown('[[ai-fluency-discernment|Discernment]]');
    expect(aliased).toContain('href="/content/ai-fluency-discernment"');
    expect(aliased).toContain('Discernment');
  });

  it('sanitizes dangerous HTML — untrusted content is not executed', async () => {
    const html = await renderMarkdown('Hi <script>alert(1)</script> <img src=x onerror=alert(2)>');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('onerror');
  });

  it('slugifies wiki targets with paths', () => {
    expect(slugifyWikiTarget('../ai-fluency/workshop')).toBe('workshop');
    expect(slugifyWikiTarget('Facilitator Script')).toBe('facilitator-script');
  });
});
