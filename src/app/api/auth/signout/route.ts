import { NextResponse, type NextRequest } from 'next/server';
import { destroySession } from '@/server/auth/session';

export async function POST(req: NextRequest) {
  await destroySession();
  return NextResponse.redirect(new URL('/en', req.nextUrl.origin));
}
