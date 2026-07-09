/**
 * Tiny structured JSON logger (M6 §4). Every line is a single JSON object so
 * log drains (Vercel, Datadog, etc.) can index by `event`/`level`/fields without
 * a parser. Intentionally dependency-free.
 */

type Fields = Record<string, unknown>;

type Level = 'info' | 'warn' | 'error';

function emit(level: Level, event: string, fields?: Fields): void {
  const line = {
    level,
    event,
    ts: new Date().toISOString(),
    ...fields,
  };
  const text = JSON.stringify(line);
  if (level === 'error') console.error(text);
  else if (level === 'warn') console.warn(text);
  else console.log(text);
}

export const log = {
  info: (event: string, fields?: Fields) => emit('info', event, fields),
  warn: (event: string, fields?: Fields) => emit('warn', event, fields),
  error: (event: string, fields?: Fields) => emit('error', event, fields),
};

/**
 * Error-tracking hook. Logs a structured error line NOW and is Sentry-ready:
 * when `SENTRY_DSN` is set the wiring below is where `Sentry.captureException`
 * goes (kept a no-op until the SDK + DSN are provisioned by the owner, so the
 * build carries no secret and no extra dependency). Never throws — an error in
 * the error path must not mask the original failure.
 */
export function captureError(err: unknown, context?: Fields): void {
  const normalized =
    err instanceof Error
      ? { name: err.name, message: err.message, stack: err.stack }
      : { message: String(err) };

  log.error('unhandled_error', { ...context, error: normalized });

  if (process.env.SENTRY_DSN) {
    // Sentry-ready seam. Left as a no-op until the SDK is installed and the DSN
    // is provisioned; wiring `Sentry.captureException(err, { extra: context })`
    // here is the only change needed to go live.
  }
}
