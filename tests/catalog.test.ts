import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '@/server/db/client';
import { importContent } from '@/server/content/importer';
import { listPublishedWorkshops } from '@/server/domain/catalog';

// M1 exit criterion: IDEAGE seed content appears in the catalog, bilingual.
describe('catalog importer', () => {
  beforeAll(async () => {
    await importContent(prisma); // idempotent upsert
  });

  it('imports the IDEAGE workshops as published, in both locales', async () => {
    const published = await listPublishedWorkshops();
    const bySlug = new Map(published.map((w) => [w.slug, w]));

    const discernment = bySlug.get('ai-fluency-discernment');
    expect(discernment).toBeDefined();
    expect(discernment?.status).toBe('published');
    expect((discernment?.title as { en?: string; ja?: string }).en).toContain('Discernment');
    expect((discernment?.title as { en?: string; ja?: string }).ja).toBeTruthy();
    expect((discernment?.summary as { ja?: string }).ja).toBeTruthy();

    expect(bySlug.get('ai-fluency-diligence')).toBeDefined();
  });

  it('attaches skills to imported workshops', async () => {
    const published = await listPublishedWorkshops();
    const discernment = published.find((w) => w.slug === 'ai-fluency-discernment');
    expect(discernment?.skills.length).toBeGreaterThan(0);
  });
});
