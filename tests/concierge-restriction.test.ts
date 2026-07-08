import { describe, it, expect } from 'vitest';
import { assertSurfaceAllowed, ToolError, getTool } from '@/server/ai/registry';
import { runConciergeTool, type ConciergeContext } from '@/server/ai/concierge';

// Concierge restriction (COPILOT_TOOLS §7, CLAUDE.md invariant 7). The NEGATIVE
// test: a concierge-surface invocation of a copilot-only tool is structurally
// rejected, while the §7 subset IS allowed on the concierge surface.

const anonCtx: ConciergeContext = { session: null, locale: 'en' };

const SECTION_7_TOOLS = [
  'catalog.search',
  'cohort.availability',
  'enrollment.begin_checkout',
  'promo.validate',
  'faq.answer',
  'handoff.to_human',
];

// A representative slice of copilot-only tools the concierge must NEVER reach.
const COPILOT_ONLY_TOOLS = [
  'workshop.create',
  'refund.execute',
  'pricing.change',
  'cohort.cancel',
  'certificate.issue',
  'attendance.record',
  'quiz.generate',
  'participant.enroll',
];

describe('assertSurfaceAllowed — concierge surface gate', () => {
  it('rejects every copilot-only tool on the concierge surface', () => {
    for (const name of COPILOT_ONLY_TOOLS) {
      expect(() => assertSurfaceAllowed(name, 'concierge')).toThrow(ToolError);
      try {
        assertSurfaceAllowed(name, 'concierge');
        throw new Error(`expected ${name} to be forbidden`);
      } catch (err) {
        expect(err).toBeInstanceOf(ToolError);
        expect((err as ToolError).code).toBe('surface_forbidden');
      }
    }
  });

  it('allows every §7 tool on the concierge surface', () => {
    for (const name of SECTION_7_TOOLS) {
      const def = assertSurfaceAllowed(name, 'concierge');
      expect(def.surfaces).toContain('concierge');
    }
  });

  it('the §7 tools are NOT registered for the copilot surface', () => {
    for (const name of SECTION_7_TOOLS) {
      const def = getTool(name);
      expect(def.surfaces).toEqual(['concierge']);
    }
  });
});

describe('runConciergeTool — the runtime choke point', () => {
  it('refuses a copilot-only tool name at execution time', async () => {
    await expect(runConciergeTool(anonCtx, 'refund.execute', { amount: 1 })).rejects.toThrow(
      ToolError,
    );
    await expect(runConciergeTool(anonCtx, 'workshop.create', {})).rejects.toThrow(ToolError);
  });

  it('allows a §7 tool (faq.answer) and always self-identifies as AI', async () => {
    const out = await runConciergeTool(anonCtx, 'faq.answer', {
      question: 'What workshops do you offer?',
    });
    expect(out).toHaveProperty('isAi', true);
    expect(String(out.answer)).toMatch(/AI/i);
  });
});
