// AdminSidebar —— admin 左侧 nav，按 NAV_GROUPS 分组（overview / corpus /
// access / jobs / integrations / settings）。每条 mono uppercase group
// header + 下面 serif label。设计源 docs/design/project/admin.js NAV_GROUPS
// (27-62)。
//
// 跟 design 差几个：dashboard / sources / listings / seo / system 还没有
// 对应路由 —— sidebar 先把链接挂出来 (404 入口)，对应 page route 在
// 后续 commit 单独加。

import Link from 'next/link';

import { SystemPulse } from '@/components/admin/chrome/SystemPulse';

export type AdminSlug =
  | 'raw' | 'wiki' | 'output' | 'conversations' | 'codes' | 'requests'
  | 'connectors' | 'page' | 'custom-pages' | 'api-mcp' | 'account'
  | 'skills' | 'posts' | 'drafts' | 'applications'
  | 'dashboard' | 'sources' | 'listings' | 'seo' | 'system'
  | 'preview' | 'obsidian';

interface SectionDef {
  slug: AdminSlug;
  label: string;
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
      { slug: 'raw', label: 'raw' },
      { slug: 'wiki', label: 'wiki' },
      { slug: 'posts', label: 'writing' },
      { slug: 'output', label: 'outputs' },
      { slug: 'custom-pages', label: 'pages' },
    ],
  },
  {
    label: 'access',
    items: [
      { slug: 'conversations', label: 'conversations' },
      { slug: 'codes', label: 'codes' },
      { slug: 'requests', label: 'requests' },
      { slug: 'preview', label: 'preview' },
    ],
  },
  {
    label: 'jobs',
    items: [
      { slug: 'sources', label: 'sources' },
      { slug: 'listings', label: 'listings' },
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

type Props = { active: AdminSlug };

export function AdminSidebar({ active }: Props) {
  return (
    <nav className="border-r border-(--color-rule) px-5 lg:px-6 py-7 flex flex-col">
      <SystemPulse />
      <Groups active={active} />
      <SidebarFooter />
    </nav>
  );
}

function Groups({ active }: { active: AdminSlug }) {
  return (
    <div className="flex flex-col gap-5">
      {NAV_GROUPS.map((g) => <Group key={g.label} group={g} active={active} />)}
    </div>
  );
}

function Group({ group, active }: { group: NavGroup; active: AdminSlug }) {
  return (
    <div>
      <div className="mono text-[9.5px] tracking-[0.22em] uppercase text-(--color-faint) mb-1.5">
        {group.label}
      </div>
      <ul className="flex flex-col">
        {group.items.map((s) => (
          <SidebarItem key={s.slug} section={s} active={s.slug === active} />
        ))}
      </ul>
    </div>
  );
}

function SidebarItem({ section, active }: { section: SectionDef; active: boolean }) {
  const tone = active ? 'text-(--color-ink)' : 'text-(--color-muted) hover:text-(--color-ink)';
  return (
    <li>
      <Link
        href={`/admin/${section.slug}`}
        className={`group w-full text-left flex items-baseline gap-3 py-1.5 transition-colors ${tone}`}
      >
        <SidebarItemMarker active={active} />
        <span
          data-testid={`admin-nav-${section.slug}`}
          className={`font-serif flex-1 text-[15.5px] tracking-[-0.005em] ${active ? 'font-medium' : ''}`}
        >
          {section.label}
        </span>
      </Link>
    </li>
  );
}

function SidebarItemMarker({ active }: { active: boolean }) {
  const cls = active ? 'text-(--color-accent)' : 'text-(--color-faint)';
  return (
    <span className={`mono text-[11px] tracking-[0.06em] tabular-nums shrink-0 w-3 ${cls}`}>
      {active ? '›' : ' '}
    </span>
  );
}

function SidebarFooter() {
  return (
    <div className="mt-auto pt-6 border-t border-(--color-rule) mono text-[10px] tracking-[0.12em] text-(--color-faint) leading-[1.7]">
      <div><span className="text-(--color-muted)">last ingest</span> 12 min ago</div>
      <div className="mt-1"><span className="text-(--color-muted)">help</span> · <span>/docs</span></div>
    </div>
  );
}
