import type { ReactNode } from 'react';

// Passthrough root layout. next-intl routes everything under [locale], whose
// layout renders <html>/<body>; the root not-found.tsx renders its own <html>.
// Next.js still requires a root layout to exist for the root not-found, so this
// only forwards children — it must NOT emit <html>/<body> or the locale tree
// would nest a second document.
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
