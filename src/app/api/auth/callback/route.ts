import { NextResponse, type NextRequest } from 'next/server';
import { consumeMagicLink } from '@/server/auth/magic-link';
import { createSession } from '@/server/auth/session';

// Follows the one-time link: verifies the token, opens a session, and redirects
// into the app in the user's locale.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') ?? '';
  const user = await consumeMagicLink(token);

  if (!user) {
    const url = new URL('/en?auth=invalid', req.nextUrl.origin);
    return NextResponse.redirect(url);
  }

  await createSession(user);
  const dest = user.role === 'owner' || user.role === 'staff' ? 'copilot' : '';
  const url = new URL(`/${user.locale}/${dest}`.replace(/\/$/, ''), req.nextUrl.origin);
  return NextResponse.redirect(url);
}
