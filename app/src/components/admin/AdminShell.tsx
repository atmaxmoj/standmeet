// AdminShell —— admin SPA chrome: TopBar + sidebar + main.
// session gating: useAdminSession auto-redirects to /login when unauthed.
//
// #34: mounted on app/admin/layout.tsx, so navigating between sections does **not** remount
// (Next layout persists) — sidebar scroll + state survive, no more resetting to top on every
// click. active highlight is derived from usePathname (layout has no access to the page's
// active prop).

'use client';

import { useCallback, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';

import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { ADMIN_SLUGS, type AdminSlug } from '@/lib/admin/nav';
import { TopBar } from '@/components/admin/chrome/TopBar';

import { useAdminSession } from '@/lib/admin/use-admin-session';
import { useSidebarBadges } from '@/lib/admin/use-sidebar-badges';

type Props = {
  children: ReactNode;
};

export function AdminShell({ children }: Props) {
  const session = useAdminSession();
  const active = adminActiveSlug(usePathname());
  return session.kind === 'ready'
    ? <AdminLayout active={active} handle={session.session.handle} email={session.session.email}>{children}</AdminLayout>
    : <Loading state={session.kind} />;
}

// adminActiveSlug —— /admin/<slug>/… -> slug; unknown/missing -> dashboard. no-if via find + ??.
//
// Which slugs are valid is decided by the **sidebar itself** (`ADMIN_SLUGS` is derived from
// `NAV_GROUPS`). This used to copy a second list, and that copy was missing `subjectivity` —
// the sidebar could render that section, but the path mapping didn't recognize it, so that
// page highlighted dashboard instead (F-N-1). One fact, one source.
function adminActiveSlug(pathname: string | null): AdminSlug {
  const seg = (pathname ?? '').replace(/^\/admin\/?/, '').split('/')[0];
  return ADMIN_SLUGS.find((s) => s === seg) ?? 'dashboard';
}

// AdminLayout —— top bar + sidebar + main content.
//
// On narrow screens the sidebar is a **drawer**, not that fixed 232px column. The reason is
// measured: on a 390px screen the sidebar still took 232, leaving only 158px for content —
// titles got clipped to "dashboar", stat cards fit one or two characters per line, `483`
// overflowed its card. And through all of this **there was zero horizontal overflow**
// (`scrollWidth === clientWidth`), so every existing assertion stayed green: elements didn't
// exceed the viewport, they were just squashed ([[text-assertion-cannot-see-layout]]).
// All 26 sections had this because the shell was broken, not any one page.
//
// Nothing moves a single pixel at `lg` and above — the feature suite runs at desktop size,
// where the sidebar stays a static column.
function AdminLayout({
  active, handle, email, children,
}: {
  active: AdminSlug; handle: string; email: string; children: ReactNode;
}) {
  const badges = useSidebarBadges();
  const [navOpen, setNavOpen] = useState(false);
  const closeNav = useCallback(() => setNavOpen(false), []);
  const toggleNav = useCallback(() => setNavOpen((v) => !v), []);
  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <TopBar handle={handle} email={email} navOpen={navOpen} onToggleNav={toggleNav} />
      <div className="flex-1 flex min-h-0">
        <AdminSidebar active={active} badges={badges} open={navOpen} onClose={closeNav} />
        {/* min-w-0: flex children default to min-width:auto — a wide table in the content
            would stretch the whole column instead of scrolling on its own. */}
        <main className="flex-1 min-w-0 px-4 sm:px-6 lg:px-12 py-6 lg:py-8 overflow-y-auto">
          {/* Fills a normal large office screen (27–32" QHD→4K); not 49"/57" ultrawides. */}
          <div className="max-w-[2400px]">{children}</div>
        </main>
      </div>
    </div>
  );
}

// Loading —— the three non-ready states each say their own thing. **`unreachable` is not
// `unauthed`** (F-N-2): sending the owner to the login page when the backend is down just makes
// them re-enter a password that was never the problem. This spells out what happened, and why
// signing in again won't help right now.
function Loading({ state }: { state: 'loading' | 'unauthed' | 'unreachable' }) {
  return (
    <main className="mx-auto max-w-md px-6 py-24">
      <p className="mono text-(--color-muted)">{LOADING_COPY[state]}</p>
    </main>
  );
}

const LOADING_COPY: Record<'loading' | 'unauthed' | 'unreachable', string> = {
  loading: 'loading admin…',
  unauthed: 'redirecting to /login…',
  unreachable: 'couldn’t reach the server — your session is fine, the instance is not '
    + 'answering. Signing in again will not help; retry once it is back.',
};
