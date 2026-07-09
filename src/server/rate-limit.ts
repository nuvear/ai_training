import type { NextRequest } from 'next/server';

/**
 * In-memory sliding-window rate limiter for PUBLIC (unauthenticated) endpoints
 * (M6 §1). Keyed by client IP × route bucket. Each bucket keeps the timestamps
 * of the requests inside the current window and rejects once the count in the
 * window reaches `limit`.
 *
 * NOTE: in-memory state suits a single serverless/instance deployment. On
 * multi-instance (Vercel fan-out) each instance has its own map, so the true
 * limit is `limit × instances`. The multi-instance upgrade is a shared store —
 * a pg table (`rate_limit_hit`) or Redis sorted-set — behind this same
 * `checkRateLimit` interface; callers do not change.
 */

export interface RateLimitConfig {
  /** Bucket name — one sliding window per (bucket, key). */
  bucket: string;
  /** Max requests allowed within the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  ok: boolean;
  /** Seconds until the caller may retry (0 when allowed). */
  retryAfter: number;
  limit: number;
  /** Requests still allowed in the current window (0 when blocked). */
  remaining: number;
}

/** bucket:key → sorted ascending list of hit timestamps (ms) within the window. */
const store = new Map<string, number[]>();

/** Injectable clock so tests drive time without real sleeps. */
let now: () => number = () => Date.now();

/** TEST ONLY: swap the clock. Pass `undefined` to restore the real clock. */
export function __setClock(clock: (() => number) | undefined): void {
  now = clock ?? (() => Date.now());
}

/** TEST ONLY: clear all buckets. */
export function __resetRateLimit(): void {
  store.clear();
}

/**
 * Records a hit and reports whether it is permitted. A blocked request is NOT
 * recorded (so a client hammering the endpoint cannot push its own reset
 * further into the future). Returns the seconds until the window frees a slot.
 */
export function checkRateLimit(key: string, config: RateLimitConfig): RateLimitResult {
  const t = now();
  const windowStart = t - config.windowMs;
  const storeKey = `${config.bucket}:${key}`;

  const hits = (store.get(storeKey) ?? []).filter((ts) => ts > windowStart);

  if (hits.length >= config.limit) {
    // Oldest in-window hit frees a slot when it ages out of the window.
    const oldest = hits[0] ?? t;
    const retryAfter = Math.max(1, Math.ceil((oldest + config.windowMs - t) / 1000));
    store.set(storeKey, hits); // keep the pruned list
    return { ok: false, retryAfter, limit: config.limit, remaining: 0 };
  }

  hits.push(t);
  store.set(storeKey, hits);
  return {
    ok: true,
    retryAfter: 0,
    limit: config.limit,
    remaining: config.limit - hits.length,
  };
}

/**
 * Best-effort client IP for rate-limit keying. Behind Vercel/most proxies the
 * left-most `x-forwarded-for` entry is the real client. Falls back to a shared
 * `unknown` bucket when no header is present (still bounds total load).
 */
export function clientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) {
    const first = fwd.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get('x-real-ip');
  if (real?.trim()) return real.trim();
  return 'unknown';
}

/** Named limits for the public endpoints (M6 §1). Tuned per DECISIONS. */
export const RATE_LIMITS = {
  magicLink: { bucket: 'magic-link', limit: 5, windowMs: 15 * 60 * 1000 }, // 5 / 15 min
  concierge: { bucket: 'concierge', limit: 20, windowMs: 60 * 1000 }, // 20 / min
  verify: { bucket: 'verify', limit: 60, windowMs: 60 * 1000 }, // 60 / min
  checkin: { bucket: 'checkin', limit: 30, windowMs: 60 * 1000 }, // 30 / min
} as const satisfies Record<string, RateLimitConfig>;

/**
 * Guards a request against a limit; returns a 429 `Response` when exceeded, or
 * `null` when the caller may proceed. Sets a `Retry-After` header per RFC 9110.
 */
export function enforceRateLimit(req: NextRequest, config: RateLimitConfig): Response | null {
  // Deterministic-test escape hatch: the e2e suite signs in many times from one
  // localhost IP, which would legitimately trip the magic-link limit. Only the
  // test env sets this; production never does. The limiter algorithm itself
  // stays fully covered by tests/rate-limit.test.ts (which calls checkRateLimit
  // directly, unaffected by this gate).
  if (process.env.RATE_LIMIT_DISABLED === '1') return null;
  const result = checkRateLimit(clientIp(req), config);
  if (result.ok) return null;
  return new Response(
    JSON.stringify({
      error: 'Too many requests. Please slow down and try again shortly.',
      retryAfter: result.retryAfter,
    }),
    {
      status: 429,
      headers: {
        'content-type': 'application/json',
        'retry-after': String(result.retryAfter),
      },
    },
  );
}
