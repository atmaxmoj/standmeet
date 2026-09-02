// AdminSidebar —— admin left nav. design source: admin.js Sidebar +
// NAV_GROUPS (27-62). mono 11.5px nav-link + "── group" headers + accent
// badge with a live count. border-left accent marks active.
//
// Each section's name is written once in `lib/admin/nav` — the sidebar's label and the big
// heading behind the door read from the same source (F-N-3).

import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { SystemPulse } from '@/components/admin/chrome/SystemPulse';
import { NAV_GROUPS, type AdminSlug, type NavGroup, type SectionDef } from '@/lib/admin/nav';
import { sidebarBadgeFor } from '@/lib/admin/sidebar-badge-for';
import { useAdminSession } from '@/lib/admin/use-admin-session';
import { useAppVersion } from '@/lib/app-version';
import { deployView, useSystemInfo } from '@/lib/admin/use-system-info';

export interface SidebarBadges {
  raw?: number;
  requests?: number;
  listings?: number;
}

type Props = {
  active: AdminSlug;
  badges?: SidebarBadges;
  // open / onClose —— only meaningful below `lg` (where the sidebar is a drawer). On desktop
  // the sidebar is always present, and neither prop is used.
  open?: boolean;
  onClose?: () => void;
};

// On narrow screens this column **leaves the document flow** (`max-lg:fixed`). Hiding it with
// translate alone isn't enough: it's still a `w-[232px] shrink-0` item in the flex row, still
// claiming its width, still leaving content with only 158px — invisible, yet still crowding,
// which is exactly the thing that needs fixing.
const SHELL = 'w-[232px] shrink-0 border-r border-(--color-rule) pb-5 flex flex-col overflow-y-auto';
// Stacking uses the `overlay` band from the table in globals.css (the half-screen scrim); the
// drawer sits on its own overlay layer: `overlay-1` is the scrim, `overlay-2` is the panel.
// **Do not** bump it up to the modal / toast bands — a toast fired while the drawer is open
// still has to stay visible (F-C-26 was bitten by exactly this ordering).
//
// `sm-z-overlay-2` carries no `max-lg:`: that's a Tailwind variant and doesn't apply to this
// hand-written CSS class (writing it compiles fine, it just generates nothing). Leaving it
// unscoped has no side effect either — on desktop this column is `static`, and z-index never
// does anything to a static element anyway.
const DRAWER = 'sm-z-overlay-2 max-lg:fixed max-lg:top-14 max-lg:bottom-0 max-lg:left-0 '
  + 'max-lg:w-[min(19rem,85vw)] max-lg:bg-(--color-paper) max-lg:shadow-xl '
  + 'max-lg:transition-transform max-lg:duration-200';
// When closed, use `invisible` rather than `aria-hidden`: a closed drawer should also be closed
// to screen readers and Tab (translate alone still lets focus walk into a column of invisible
// links, with no way for the person to know where they went) — but `aria-hidden` is an
// attribute with no breakpoint variant, so setting it would also hide **the sidebar that's
// permanently present on desktop**. `visibility` covers both the a11y tree and tab order, and
// it can be scoped by breakpoint, which is exactly what's needed here.
const CLOSED = 'max-lg:-translate-x-full max-lg:invisible lg:visible';

export function AdminSidebar({ active, badges, open = false, onClose }: Props) {
  return (
    <>
      {open ? <Scrim onClose={onClose} /> : null}
      <nav
        id="admin-sidebar"
        data-testid="admin-sidebar"
        // Clicking any item in the drawer closes it — handled here via bubbling, so it doesn't
        // need to be threaded through every item.
        //
        // Attached here rather than to "close on route change": the latter doesn't fire when
        // **re-clicking the currently active section** (`active` doesn't change), so the
        // drawer would stay open covering the content right after the person just acted to go
        // look at it. On desktop onClose is undefined, so this line does nothing.
        onClick={onClose}
        className={navCls(open)}
      >
        <SystemPulse />
        <Groups active={active} badges={badges} />
        <SidebarFooter />
      </nav>
    </>
  );
}

function navCls(open: boolean): string {
  return `${SHELL} ${DRAWER} ${open ? 'max-lg:translate-x-0' : CLOSED}`;
}

// Scrim —— the layer behind the drawer. It doubles as the **tap-outside-to-close** action:
// there's nowhere else to tap on a phone.
function Scrim({ onClose }: { onClose?: () => void }) {
  const t = useTranslations('adminShell.sidebar');
  return (
    <button
      type="button"
      aria-label={t('closeNav')}
      onClick={onClose}
      className="lg:hidden fixed inset-x-0 bottom-0 top-14 sm-z-overlay-1 bg-(--color-ink)/25"
    />
  );
}

function Groups({ active, badges }: { active: AdminSlug; badges?: SidebarBadges }) {
  return (
    <div className="flex flex-col">
      {NAV_GROUPS.map((g) => <Group key={g.label} group={g} active={active} badges={badges} />)}
    </div>
  );
}

function Group({ group, active, badges }: { group: NavGroup; active: AdminSlug; badges?: SidebarBadges }) {
  const t = useTranslations('adminShell.sidebar');
  return (
    <div className="py-1.5">
      <div className="mono text-[9.5px] tracking-[0.22em] uppercase text-(--color-faint) px-4 py-1">
        {t('groupPrefix')} {group.label}
      </div>
      {group.items.map((s) => (
        <SidebarItem key={s.slug} section={s} active={s.slug === active} badge={sidebarBadgeFor(s.slug, badges)} />
      ))}
    </div>
  );
}


function SidebarItem({ section, active, badge }: { section: SectionDef; active: boolean; badge: number | null }) {
  return (
    <Link
      href={`/admin/${section.slug}`}
      className={navLinkCls(active)}
      aria-current={active ? 'page' : undefined}
    >
      <span data-testid={`admin-nav-${section.slug}`} className="flex-1">{section.label}</span>
      <Badge count={badge} testId={section.badgeTestId} />
    </Link>
  );
}

function navLinkCls(active: boolean): string {
  const base = 'flex items-baseline gap-2.5 px-4 py-[5px] mono text-[11.5px] tracking-[0.04em] cursor-pointer border-l-2 transition-colors';
  return active
    ? `${base} text-(--color-ink) border-l-(--color-accent) bg-(--color-surface)`
    : `${base} text-(--color-muted) border-l-transparent hover:text-(--color-ink) hover:bg-(--color-surface)/50`;
}

function Badge({ count, testId }: { count: number | null; testId?: string }) {
  return count !== null ? (
    <span
      data-testid={testId}
      className="ml-auto mono text-[9px] tracking-[0.06em] text-(--color-accent) tabular-nums"
    >
      {count}
    </span>
  ) : null;
}

// SidebarFooter —— these two lines are visible to the owner on every admin page, so both must
// be about **this specific** machine. The previous version was `instance · standmeet` (an i18n
// constant — every instance said the same thing, so it said nothing) plus `uptime · —` (the
// dash was a JSX literal), while /admin/system was showing the real uptime at the same moment —
// the value was there all along, just never wired in. Now both places read the same
// system-info store, so they can no longer disagree (UX-27).
function SidebarFooter() {
  const t = useTranslations('adminShell.sidebar');
  const { info } = useSystemInfo();
  const session = useAdminSession();
  const handle = session.kind === 'ready' ? session.session.handle : '';
  return (
    <div className="mt-auto px-4 pt-4 border-t border-(--color-rule) mono text-[9.5px] tracking-[0.06em] text-(--color-faint) leading-[1.6]">
      <div>
        {t('instanceLabel')}{' '}
        <span className="text-(--color-muted)" data-testid="sidebar-instance">{handle}</span>
      </div>
      <div>
        {t('uptimeLabel')}{' '}
        <span className="text-(--color-muted)" data-testid="sidebar-uptime">{deployView(info).uptime}</span>
      </div>
      <NarrowFooterExtras />
    </div>
  );
}

// NarrowFooterExtras —— the items that don't fit the top bar on narrow screens (version, who's
// signed in, link to the public page) land here. This section already tells "what instance is
// this"; version and identity are two lines of the same story. At `lg` and above they move back
// to the top bar, and this block collapses so desktop doesn't repeat them.
function NarrowFooterExtras() {
  const t = useTranslations('adminShell.topBar');
  const buildTag = useAppVersion();
  const session = useAdminSession();
  const email = session.kind === 'ready' ? session.session.email : '';
  return (
    <div className="lg:hidden mt-2 pt-2 border-t border-(--color-rule) flex flex-col gap-1">
      <div>
        {t('versionLabel')}{' '}
        <span className="text-(--color-muted)" data-testid="sidebar-build-tag">{buildTag}</span>
      </div>
      <div className="truncate text-(--color-muted)">{email}</div>
      <Link href="/" className="uppercase tracking-[0.14em] hover:text-(--color-accent) transition-colors">
        {t('viewPublic')}
      </Link>
    </div>
  );
}
