// TopBar — the admin header bar. Left: standmeet · {handle} · admin · live dot.
// Center: CorpusConstellation (corpus link graph: node size = link degree).
// Right: build info + email + sign-out.

'use client';

import Link from 'next/link';
import { useCallback } from 'react';
import { useTranslations } from 'next-intl';

import { CorpusConstellation } from '@/components/admin/chrome/CorpusConstellation';
import { LocaleSwitch } from '@/components/page/LocaleSwitch';
import { Pill } from '@/components/admin/atoms/Pill';
import { useAppVersion } from '@/lib/app-version';
import { signOut } from '@/lib/admin/sign-out';
import { useInstanceLiveness } from '@/lib/state/instance-liveness';

type Props = {
  handle: string;
  email: string;
  // Toggle for the sidebar drawer. Only shown below `lg` — the sidebar is always
  // visible on desktop, so no toggle is needed there.
  navOpen: boolean;
  onToggleNav: () => void;
};

// The version string comes from useAppVersion — reported by the running process
// itself. The previous version had a `buildTag?: string` prop with a constant
// default, and no call site ever passed it: that prop's only effect was making
// a constant look like it came "from outside" (F-C-10). The prop is gone now.
export function TopBar({ handle, email, navOpen, onToggleNav }: Props) {
  const buildTag = useAppVersion();
  const onSignOut = useCallback(() => void signOut(), []);
  return (
    <header className="flex items-center px-4 sm:px-6 lg:px-8 h-14 border-b border-(--color-rule) shrink-0 gap-3 sm:gap-4">
      <NavToggle open={navOpen} onToggle={onToggleNav} />
      <TopBarBrand handle={handle} />
      {/* The constellation is a **decorative** information layer. On narrow
          screens it competes with the brand block and the right-side group for
          the same 56px bar, and all three get squeezed. It's the one thing here
          that loses nothing if dropped, so it's the one that gets dropped. */}
      <div className="hidden lg:contents"><CorpusConstellation /></div>
      <TopBarMeta email={email} buildTag={buildTag} onSignOut={onSignOut} />
    </header>
  );
}

// NavToggle — the drawer toggle. Text, not an icon: this whole chrome speaks in
// lowercase mono labels (`view public ↗` / `sign out`); a hamburger icon would
// import a different vocabulary.
function NavToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const t = useTranslations('adminShell.topBar');
  return (
    <button
      type="button"
      onClick={onToggle}
      data-testid="admin-nav-toggle"
      aria-expanded={open}
      aria-controls="admin-sidebar"
      className="lg:hidden shrink-0 mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-accent) transition-colors"
    >
      {open ? t('navClose') : t('navOpen')}
    </button>
  );
}

// On narrow screens this bar is only 358px wide, and it has to fit `sections`
// + the full brand name + version + `view public` + `sign out`. The previous
// version had every group `shrink-0`, so the right-side group got pushed
// entirely off screen: the version badge was cut to half a circle, and
// `sign out` — the owner's only sign-out entry point — didn't show at all.
//
// What yields is the **explanatory** segments (`/ admin · <handle>` — the
// person is already in admin, and the title bar already says whose instance
// this is). What stays is the brand, whether this machine is alive, and
// sign-out. What moved isn't gone: version, email, and view public live in
// the drawer footer, which already explains what this instance is.
function TopBarBrand({ handle }: { handle: string }) {
  const t = useTranslations('adminShell.topBar');
  return (
    <div className="flex items-baseline gap-3 mono text-[11px] tracking-[0.14em] uppercase min-w-0">
      <span className="text-(--color-ink)">{t('brand')}</span>
      <span className="text-(--color-faint) hidden lg:inline">/</span>
      <span className="text-(--color-muted) hidden lg:inline">{t('admin')}</span>
      <span className="text-(--color-faint) hidden lg:inline">·</span>
      <span className="text-(--color-muted) hidden lg:inline truncate">{handle}</span>
      <LiveDot />
    </div>
  );
}

// LiveDot — the word it shows must **be** this instance's current state (F-N-6).
// It used to be a constant: when the backend was down and the body said the
// section failed to load, the header still said `● LIVE`.
// Now it reads instance-liveness — derived from requests that already
// happened, no extra polling.
function LiveDot() {
  const t = useTranslations('adminShell.topBar');
  const liveness = useInstanceLiveness();
  const live = liveness === 'live';
  return (
    <span className="inline-flex items-center gap-1.5 ml-2">
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${live
        ? 'bg-(--color-accent) live-dot'
        : 'bg-(--color-faint)'}`}
      />
      <span
        data-testid="shell-liveness"
        className="text-(--color-faint) text-[9.5px] tracking-[0.18em]"
      >
        {live ? t('live') : t('notAnswering')}
      </span>
    </span>
  );
}

function TopBarMeta({
  email, buildTag, onSignOut,
}: { email: string; buildTag: string; onSignOut: () => void }) {
  const t = useTranslations('adminShell.topBar');
  return (
    <div className="flex items-baseline gap-4 shrink-0 ml-auto">
      {/* Version / view public / email yield to `sign out` on narrow screens;
          all three live in the drawer footer. */}
      <span className="hidden lg:inline"><Pill tone="muted" testId="build-tag">{buildTag}</Pill></span>
      <Link
        href="/"
        className="mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-faint) hover:text-(--color-accent) transition-colors hidden lg:inline"
      >
        {t('viewPublic')}
      </Link>
      <span className="mono text-[10.5px] text-(--color-muted) hidden xl:inline">{email}</span>
      <LocaleSwitch />
      <button
        type="button"
        onClick={onSignOut}
        data-testid="signout"
        className="mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-faint) hover:text-(--color-accent) transition-colors"
      >
        {t('signOut')}
      </button>
    </div>
  );
}
