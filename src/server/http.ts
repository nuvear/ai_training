import { NextResponse } from 'next/server';
import { AuthError } from './auth/rbac';
import { ToolError } from './ai/registry';
import { LedgerError } from './ai/ledger';
import { captureError } from './observability/logger';

/** Maps known server errors to JSON responses; anything else is a 500. */
export function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof AuthError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof LedgerError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof ToolError) {
    const status = err.code === 'invalid_input' ? 400 : err.code === 'unknown_tool' ? 404 : 403;
    return NextResponse.json({ error: err.message, code: err.code }, { status });
  }
  captureError(err, { source: 'toErrorResponse' });
  return NextResponse.json({ error: 'Internal error' }, { status: 500 });
}
