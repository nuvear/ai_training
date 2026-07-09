import { describe, it, expect } from 'vitest';
import {
  bilingualText,
  isBilingualComplete,
  assertBilingualComplete,
} from '@/server/ai/i18n-content';

// CLAUDE.md invariant 1: no entity leaves draft without BOTH locales. This is
// the schema-level proof of that gate.
describe('bilingual content gate', () => {
  it('accepts a value with both en and ja', () => {
    expect(isBilingualComplete({ en: 'Hello', ja: 'こんにちは' })).toBe(true);
  });

  it('rejects a value missing the ja locale', () => {
    expect(isBilingualComplete({ en: 'Hello' })).toBe(false);
    expect(bilingualText.safeParse({ en: 'Hello' }).success).toBe(false);
  });

  it('rejects a value missing the en locale', () => {
    expect(isBilingualComplete({ ja: 'こんにちは' })).toBe(false);
  });

  it('rejects empty/whitespace-only locales', () => {
    expect(isBilingualComplete({ en: '', ja: 'こんにちは' })).toBe(false);
    expect(isBilingualComplete({ en: 'Hi', ja: '   ' })).toBe(false);
  });

  it('assertBilingualComplete throws on incomplete content', () => {
    expect(() => assertBilingualComplete({ en: 'only english' })).toThrow();
  });
});
