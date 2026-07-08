import { z } from 'zod';
import type { Prisma } from '@/generated/prisma';
import type { ToolDefinition } from '../types';
import { isBilingualComplete, type BilingualText } from '../i18n-content';
import { NotFoundError, InvalidStateError, BilingualIncompleteError } from '@/server/domain/errors';
import { resolveCompletionRule } from '@/server/domain/completion';
import {
  generateQuiz,
  loadWorkshopBody,
  type Difficulty,
  type WorkshopSource,
} from '@/server/domain/quiz-gen';

// quiz.generate (COPILOT_TOOLS §2) — auto-tier. Lands a Quiz(status ai_draft) +
// QuizQuestions generated from the workshop's actual content (Anthropic when
// keyed, else a deterministic bilingual stub). Staff review before publish.
//
// quiz.publish (COPILOT_TOOLS §2) — approve-tier. Bilingual gate: every question
// (prompt, every option, explanation) and the title must have both locales, then
// flip ai_draft → published.

const generateInput = z.object({
  workshopId: z.string().uuid(),
  nQuestions: z.number().int().min(1).max(20).default(5),
  difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
});
type GenerateInput = z.infer<typeof generateInput>;

interface GenerateOutput {
  quizId: string;
  status: 'ai_draft';
  nQuestions: number;
  provider: 'anthropic' | 'stub';
}

export const quizGenerate: ToolDefinition<GenerateInput, GenerateOutput> = {
  name: 'quiz.generate',
  tier: 'auto',
  surfaces: ['copilot'],
  input: generateInput,
  summarize: (i) => ({
    en: `Generate a ${i.nQuestions}-question ${i.difficulty} quiz for workshop ${i.workshopId.slice(0, 8)}`,
    ja: `ワークショップ ${i.workshopId.slice(0, 8)} の${i.nQuestions}問（${i.difficulty}）のクイズを生成`,
  }),
  handler: async (ctx, i) => {
    const workshop = await ctx.tx.workshop.findUnique({
      where: { id: i.workshopId },
      include: { skills: { include: { skill: true } } },
    });
    if (!workshop) throw new NotFoundError('Workshop', i.workshopId);

    const body = loadWorkshopBody(workshop.slug);
    const src: WorkshopSource = {
      title: workshop.title as BilingualText,
      summary: workshop.summary as BilingualText,
      skills: workshop.skills.map((ws) => (ws.skill.name as BilingualText).en),
      bodyEn: body.bodyEn,
      bodyJa: body.bodyJa,
    };

    const generated = await generateQuiz(src, i.nQuestions, i.difficulty as Difficulty);

    // passPct default derives from the workshop's completion rule (quiz_pass_pct).
    const rule = resolveCompletionRule(workshop.completionRule);

    const quiz = await ctx.tx.quiz.create({
      data: {
        workshopId: workshop.id,
        title: generated.title as unknown as Prisma.InputJsonValue,
        passPct: rule.quiz_pass_pct,
        status: 'ai_draft',
      },
    });

    await ctx.tx.quizQuestion.createMany({
      data: generated.questions.map((q, idx) => ({
        quizId: quiz.id,
        seq: idx + 1,
        prompt: q.prompt as unknown as Prisma.InputJsonValue,
        options: q.options as unknown as Prisma.InputJsonValue,
        correctKey: q.correctKey,
        explanation: q.explanation as unknown as Prisma.InputJsonValue,
      })),
    });

    return {
      quizId: quiz.id,
      status: 'ai_draft',
      nQuestions: generated.questions.length,
      provider: generated.provider,
    };
  },
};

const publishInput = z.object({ quizId: z.string().uuid() });
type PublishInput = z.infer<typeof publishInput>;

interface PublishOutput {
  quizId: string;
  status: 'published';
}

export const quizPublish: ToolDefinition<PublishInput, PublishOutput> = {
  name: 'quiz.publish',
  tier: 'approve',
  surfaces: ['copilot'],
  input: publishInput,
  summarize: (i) => ({
    en: `Publish quiz ${i.quizId.slice(0, 8)} after staff review`,
    ja: `スタッフ確認後にクイズ ${i.quizId.slice(0, 8)} を公開`,
  }),
  handler: async (ctx, i) => {
    const quiz = await ctx.tx.quiz.findUnique({
      where: { id: i.quizId },
      include: { questions: true },
    });
    if (!quiz) throw new NotFoundError('Quiz', i.quizId);
    if (quiz.status === 'published') {
      throw new InvalidStateError('Quiz is already published');
    }
    if (quiz.questions.length === 0) {
      throw new InvalidStateError('Cannot publish a quiz with no questions');
    }

    // Bilingual gate (CLAUDE.md invariant 1/6): title + every question's prompt,
    // options, and explanation must have both locales.
    const missing: Array<{ field: string; locale: 'en' | 'ja' }> = [];
    const check = (field: string, value: unknown) => {
      if (isBilingualComplete(value)) return;
      const v = (value ?? {}) as { en?: unknown; ja?: unknown };
      if (typeof v.en !== 'string' || !v.en.trim()) missing.push({ field, locale: 'en' });
      if (typeof v.ja !== 'string' || !v.ja.trim()) missing.push({ field, locale: 'ja' });
    };

    check('title', quiz.title);
    for (const q of quiz.questions) {
      check(`q${q.seq}.prompt`, q.prompt);
      check(`q${q.seq}.explanation`, q.explanation);
      const options = (q.options ?? {}) as Record<string, unknown>;
      for (const key of Object.keys(options)) {
        check(`q${q.seq}.option.${key}`, options[key]);
      }
    }

    if (missing.length > 0) {
      throw new BilingualIncompleteError([...new Set(missing.map((m) => m.field))], missing);
    }

    await ctx.tx.quiz.update({ where: { id: quiz.id }, data: { status: 'published' } });
    return { quizId: quiz.id, status: 'published' };
  },
};
