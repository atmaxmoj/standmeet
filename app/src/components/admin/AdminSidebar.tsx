// AdminSidebar —— admin 左侧 nav。design 源 admin.js Sidebar (166-193) +
// NAV_GROUPS (27-62)。mono 11.5px nav-link + "── group" headers + accent
// badge 动态计数。border-left accent 标 active。

import Link from 'next/link';

import { SystemPulse } from '@/components/admin/chrome/SystemPulse';
import { sidebarBadgeFor } from '@/lib/admin/sidebar-badge-for';

export type AdminSlug =
  | 'raw' | 'wiki' | 'output' | 'conversations' | 'codes' | 'requests'
  | 'connectors' | 'page' | 'custom-pages' | 'api-mcp' | 'account'
  | 'skills' | 'writings' | 'drafts' | 'applications'
  | 'dashboard' | 'sources' | 'listings' | 'seo' | 'system'
  | 'preview' | 'obsidian' | 'agent-skills';

interface SectionDef {
  slug: AdminSlug;
  label: string;
  badgeTestId?: string;
}

interface NavGroup {
  label: string;
  items: readonly SectionDef[];
}

const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: 'overview',
    items: [{ slug: 'dashboard', label: 'dashboard' }],
  },
  {
    label: 'corpus',
    items: [
      { slug: 'raw', label: 'raw', badgeTestId: 'badge-raw' },
      { slug: 'wiki', label: 'wiki' },
      { slug: 'writings', label: 'writings' },
      { slug: 'output', label: 'outputs' },
      { slug: 'custom-pages', label: 'pages' },
    ],
  },
  {
    label: 'access',
    items: [
      { slug: 'conversations', label: 'conversations' },
      { slug: 'codes', label: 'codes' },
      { slug: 'requests', label: 'requests', badgeTestId: 'badge-requests' },
      { slug: 'preview', label: 'preview' },
    ],
  },
  {
    label: 'jobs',
    items: [
      { slug: 'sources', label: 'sources' },
      { slug: 'listings', label: 'listings', badgeTestId: 'badge-listings' },
      { slug: 'drafts', label: 'drafts' },
      { slug: 'applications', label: 'applications' },
      { slug: 'skills', label: 'skills' },
    ],
  },
  {
    label: 'integrations',
    items: [
      { slug: 'connectors', label: 'connectors' },
      { slug: 'api-mcp', label: 'api · mcp' },
      { slug: 'obsidian', label: 'obsidian' },
      { slug: 'agent-skills', label: 'agent skills' },
    ],
  },
  {
    label: 'settings',
    items: [
      { slug: 'page', label: 'public page' },
      { slug: 'seo', label: 'seo' },
      { slug: 'account', label: 'account' },
      { slug: 'system', label: 'system' },
    ],
  },
];

export interface SidebarBadges {
  raw?: number;
  requests?: number;
  listings?: number;
}

type Props = { active: AdminSlug; badges?: SidebarBadges };

export function AdminSidebar({ active, badges }: Props) {
  return (
    <nav className="w-[232px] border-r border-(--color-rule) py-5 flex flex-col sticky top-[56px] self-start overflow-y-auto h-[calc(100vh-56px)]">
      <SystemPulse />
      <Groups active={active} badges={badges} />
      <SidebarFooter />
    </nav>
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
  return (
    <div className="py-1.5">
      <div className="mono text-[9.5px] tracking-[0.22em] uppercase text-(--color-faint) px-4 py-1">
        ── {group.label}
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

function SidebarFooter() {
  return (
    <div className="mt-auto px-4 pt-4 border-t border-(--color-rule) mono text-[9.5px] tracking-[0.06em] text-(--color-faint) leading-[1.6]">
      <div>instance · <span className="text-(--color-muted)">standmeet</span></div>
      <div>uptime · <span className="text-(--color-muted)">—</span></div>
    </div>
  );
}
