import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

// Locale-aware navigation primitives. <Link> and useRouter keep the active
// locale prefix so the switcher never loses page state.
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
