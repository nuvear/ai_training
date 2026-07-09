import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { PrismaClient } from '@/generated/prisma';
import { parseFrontmatter } from './markdown';
// Relative import (not the @ alias) so tsx can run this from prisma/seed.ts.
import { slugify } from '../ai/schemas';

// Catalog importer: seeds workshops + skills from the frontmatter of
// content/ideage/<slug>/workshop.md (CLAUDE.md invariant 6 — frontmatter is the
// import source). A workshop is imported as `published` only when its
// frontmatter says so AND both locales of title/summary are present.

interface WorkshopFrontmatter {
  type?: string;
  slug?: string;
  title?: { en?: string; ja?: string };
  summary?: { en?: string; ja?: string };
  description?: { en?: string; ja?: string };
  outcomes?: { en?: string; ja?: string };
  level?: 'intro' | 'intermediate' | 'advanced';
  skills?: string[];
  status?: 'draft' | 'published';
  localization?: 'ai_localized' | 'human_reviewed';
}

const CONTENT_ROOT = join(process.cwd(), 'content', 'ideage');

function bothLocales(v?: { en?: string; ja?: string }): boolean {
  return Boolean(v?.en?.trim() && v?.ja?.trim());
}

export async function importContent(
  prisma: PrismaClient,
): Promise<{ imported: number; published: number; skipped: string[] }> {
  const skipped: string[] = [];
  let imported = 0;
  let published = 0;

  if (!existsSync(CONTENT_ROOT)) return { imported, published, skipped };

  const dirs = readdirSync(CONTENT_ROOT).filter((name) => {
    const p = join(CONTENT_ROOT, name);
    return statSync(p).isDirectory() && existsSync(join(p, 'workshop.md'));
  });

  for (const dir of dirs) {
    const raw = readFileSync(join(CONTENT_ROOT, dir, 'workshop.md'), 'utf8');
    const { data } = parseFrontmatter(raw);
    const fm = data as WorkshopFrontmatter;

    if (!fm.title?.en) {
      skipped.push(`${dir}: missing title.en`);
      continue;
    }

    const slug = slugify(fm.slug || dir);
    // Publish only when frontmatter asks AND both locales exist for title+summary.
    const canPublish =
      fm.status === 'published' && bothLocales(fm.title) && bothLocales(fm.summary);
    const status = canPublish ? 'published' : 'draft';
    const reviewLocale = fm.localization === 'human_reviewed' ? 'human_reviewed' : 'ai_localized';

    const workshop = await prisma.workshop.upsert({
      where: { slug },
      update: {
        title: fm.title ?? {},
        summary: fm.summary ?? {},
        description: fm.description ?? {},
        outcomes: fm.outcomes ?? {},
        level: fm.level ?? 'intro',
        status,
        localizationReview: { en: 'human_reviewed', ja: reviewLocale },
      },
      create: {
        slug,
        title: fm.title ?? {},
        summary: fm.summary ?? {},
        description: fm.description ?? {},
        outcomes: fm.outcomes ?? {},
        level: fm.level ?? 'intro',
        status,
        localizationReview: { en: 'human_reviewed', ja: reviewLocale },
      },
    });

    for (const skillName of fm.skills ?? []) {
      const s = slugify(skillName);
      const skill = await prisma.skill.upsert({
        where: { slug: s },
        update: {},
        create: { slug: s, name: { en: skillName, ja: skillName } },
      });
      await prisma.workshopSkill.upsert({
        where: { workshopId_skillId: { workshopId: workshop.id, skillId: skill.id } },
        update: {},
        create: { workshopId: workshop.id, skillId: skill.id },
      });
    }

    imported += 1;
    if (status === 'published') published += 1;
  }

  return { imported, published, skipped };
}
