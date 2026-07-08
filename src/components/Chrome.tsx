import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { getSession } from '@/server/auth/session';
import { STAFF_ROLES } from '@/server/auth/rbac';
import { LocaleSwitcher } from './LocaleSwitcher';

type Tab = 'home' | 'catalog' | 'copilot' | 'approvals' | 'admin' | 'org' | 'me';

// Top chrome: wordmark (§2 "OS" in accent), tabs, locale switcher, sign in/out.
// Staff-only tabs appear only for owner/staff sessions.
export async function Chrome({ locale, active }: { locale: string; active: Tab }) {
  const t = await getTranslations('Chrome');
  const tAuth = await getTranslations('Auth');
  const session = await getSession();
  const isStaff = session ? STAFF_ROLES.includes(session.role) : false;
  const isOrgAdmin = session?.role === 'org_admin' && !!session.organizationId;
  const isParticipant = session?.role === 'participant';

  return (
    <header className="chrome">
      <Link href="/" className="wordmark" aria-label="WorkshopOS home">
        Workshop<b>OS</b>
      </Link>
      <nav className="tabs" aria-label="Primary">
        <Link href="/" className={`tab ${active === 'home' ? 'on' : ''}`}>
          {t('home')}
        </Link>
        <Link href="/catalog" className={`tab ${active === 'catalog' ? 'on' : ''}`}>
          {t('catalog')}
        </Link>
        {isStaff && (
          <>
            <Link href="/admin/workshops" className={`tab ${active === 'admin' ? 'on' : ''}`}>
              {t('admin')}
            </Link>
            <Link href="/copilot" className={`tab ${active === 'copilot' ? 'on' : ''}`}>
              {t('copilot')}
            </Link>
            <Link href="/approvals" className={`tab ${active === 'approvals' ? 'on' : ''}`}>
              {t('approvals')}
            </Link>
          </>
        )}
        {isOrgAdmin && (
          <Link
            href={`/org/${session.organizationId}`}
            className={`tab ${active === 'org' ? 'on' : ''}`}
            data-testid="org-tab"
          >
            {t('org')}
          </Link>
        )}
        {isParticipant && (
          <Link href="/me" className={`tab ${active === 'me' ? 'on' : ''}`} data-testid="me-tab">
            {t('me')}
          </Link>
        )}
        <Link href="/help" className="tab" data-testid="help-link">
          {t('help')}
        </Link>
      </nav>
      <LocaleSwitcher current={locale} />
      {session ? (
        <form action="/api/auth/signout" method="post">
          <button type="submit" className="tab" data-testid="sign-out">
            {tAuth('signOut')}
          </button>
        </form>
      ) : (
        <Link href="/signin" className="tab" data-testid="sign-in-link">
          {tAuth('heading')}
        </Link>
      )}
    </header>
  );
}
