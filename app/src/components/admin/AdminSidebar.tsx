// AdminSidebar —— admin 左侧 nav。design 源 admin.js Sidebar +
// NAV_GROUPS (27-62)。mono 11.5px nav-link + "── group" headers + accent
// badge 动态计数。border-left accent 标 active。

import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { SystemPulse } from '@/components/admin/chrome/SystemPulse';
import { sidebarBadgeFor } from '@/lib/admin/sidebar-badge-for';
import { useAdminSession } from '@/lib/admin/use-admin-session';
import { deployView, useSystemInfo } from '@/lib/admin/use-system-info';

export type AdminSlug =
  | 'raw' | 'wiki' | 'subjectivity' | 'output' | 'conversations' | 'codes' | 'requests'
  | 'connectors' | 'page' | 'custom-pages' | 'api-mcp' | 'account'
  | 'skills' | 'writings' | 'drafts' | 'applications'
  | 'dashboard' | 'sources' | 'listings' | 'seo' | 'system'
  | 'preview' | 'obsidian'
  | 'roles' | 'prompts' | 'ip-bans';

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
      // subjectivity 只读:它的写口是 MCP(自我模型是边想边写出来的,不是填出来的)。
      // 有这一条是为了"看得见 + 挂得上文件" —— 在它之前面板上一个界面都没有。
      { slug: 'subjectivity', label: 'subjectivity' },
      { slug: 'writings', label: 'writings' },
      { slug: 'output', label: 'outputs' },
      { slug: 'custom-pages', label: 'custom pages' },
    ],
  },
  {
    label: 'access',
    items: [
      { slug: 'conversations', label: 'conversations' },
      { slug: 'codes', label: 'codes' },
      { slug: 'roles', label: 'roles' },
      { slug: 'prompts', label: 'prompts' },
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
    ],
  },
  {
    label: 'settings',
    items: [
      { slug: 'page', label: 'landing page' },
      { slug: 'seo', label: 'seo' },
      { slug: 'ip-bans', label: 'ip bans' },
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
    <nav
      data-testid="admin-sidebar"
      className="w-[232px] shrink-0 border-r border-(--color-rule) pb-5 flex flex-col overflow-y-auto"
    >
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

// ADMIN_SLUGS —— 侧栏**渲染出来的**那些 slug，从 NAV_GROUPS 算，不另抄一份。
//
// F-N-1：`AdminShell` 曾自己维护第二份 `KNOWN_SLUGS` 用来把路径映射成"当前节"，
// 而那份漏了 `subjectivity` —— 于是 `/admin/subjectivity` 走「未知 → dashboard」的兜底，
// 侧栏高亮的是 dashboard。侧栏渲得出这一节，路径映射却不认识它：**同一份事实两份存**。
// 现在只有 NAV_GROUPS 一份，加一节就自动被认识。
export const ADMIN_SLUGS: readonly AdminSlug[] =
  NAV_GROUPS.flatMap((g) => g.items.map((i) => i.slug));

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

// SidebarFooter —— 这两行 owner 在 admin 每一页都看得见,所以两行都必须是关于**这台**机器的。
// 上一版是 `instance · standmeet`(i18n 常量:每台实例都这么写,于是它谁也没说)加
// `uptime · —`(横杠是 JSX 字面量)。而 /admin/system 同一时刻显示着真的 uptime —— 值一直
// 在,只是没接过来。现在两处读同一个 system-info store,不可能再各说各的(UX-27)。
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
    </div>
  );
}
