import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  checkRateLimit,
  __setClock,
  __resetRateLimit,
  type RateLimitConfig,
} from '@/server/rate-limit';

// Drive a controllable clock — no real sleeps. The limiter is a pure function of
// (now, recorded hits), so advancing `t` deterministically exercises the window.
let t = 1_000_000;
const cfg: RateLimitConfig = { bucket: 'test', limit: 3, windowMs: 1000 };

beforeEach(() => {
  t = 1_000_000;
  __setClock(() => t);
  __resetRateLimit();
});

afterEach(() => {
  __setClock(undefined);
  __resetRateLimit();
});

describe('in-memory sliding-window rate limiter', () => {
  it('allows up to the limit, then blocks with a Retry-After', () => {
    expect(checkRateLimit('ip-a', cfg).ok).toBe(true); // 1
    expect(checkRateLimit('ip-a', cfg).ok).toBe(true); // 2
    const third = checkRateLimit('ip-a', cfg);
    expect(third.ok).toBe(true); // 3 (at limit)
    expect(third.remaining).toBe(0);

    const blocked = checkRateLimit('ip-a', cfg); // 4th → blocked
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
    expect(blocked.remaining).toBe(0);
  });

  it('keys buckets per client — one IP does not exhaust another', () => {
    checkRateLimit('ip-a', cfg);
    checkRateLimit('ip-a', cfg);
    checkRateLimit('ip-a', cfg);
    expect(checkRateLimit('ip-a', cfg).ok).toBe(false);
    // Fresh IP starts with a full window.
    expect(checkRateLimit('ip-b', cfg).ok).toBe(true);
  });

  it('resets after the window fully elapses', () => {
    checkRateLimit('ip-a', cfg);
    checkRateLimit('ip-a', cfg);
    checkRateLimit('ip-a', cfg);
    expect(checkRateLimit('ip-a', cfg).ok).toBe(false);

    // Advance past the window so all prior hits age out.
    t += cfg.windowMs + 1;
    const afterReset = checkRateLimit('ip-a', cfg);
    expect(afterReset.ok).toBe(true);
    expect(afterReset.remaining).toBe(cfg.limit - 1);
  });

  it('slides: an old hit freeing up admits exactly one new request', () => {
    checkRateLimit('ip-a', cfg); // t0
    t += 400;
    checkRateLimit('ip-a', cfg); // t0+400
    t += 400;
    checkRateLimit('ip-a', cfg); // t0+800 (now 3 in window)
    expect(checkRateLimit('ip-a', cfg).ok).toBe(false);

    // Advance just past the FIRST hit's expiry (t0 + 1000). Now only 2 remain in
    // window → one slot frees, exactly one request admitted.
    t += 201; // total 1001 since first hit
    expect(checkRateLimit('ip-a', cfg).ok).toBe(true);
    expect(checkRateLimit('ip-a', cfg).ok).toBe(false);
  });

  it('a blocked request does not extend its own window', () => {
    checkRateLimit('ip-a', cfg);
    checkRateLimit('ip-a', cfg);
    checkRateLimit('ip-a', cfg);
    // Hammer while blocked — none of these are recorded.
    checkRateLimit('ip-a', cfg);
    checkRateLimit('ip-a', cfg);

    // The window still ends relative to the 3 real hits, not the blocked ones.
    t += cfg.windowMs + 1;
    expect(checkRateLimit('ip-a', cfg).ok).toBe(true);
  });
});
