import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

// next-intl middleware handles locale detection + the /en · /ja prefixing.
// RBAC is enforced server-side in each route/page (see src/server/auth), not
// here, so that API routes and Server Components share one enforcement path.
export default createMiddleware(routing);

export const config = {
  // Skip Next internals, API routes, and static files.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
