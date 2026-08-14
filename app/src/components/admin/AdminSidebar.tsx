// AdminSidebar —— admin 左侧 nav。design 源 admin.js Sidebar +
// NAV_GROUPS (27-62)。mono 11.5px nav-link + "── group" headers + accent
// badge 动态计数。border-left accent 标 active。
//
// 每一节叫什么在 `lib/admin/nav` 里写一次 —— 侧栏的牌子和门后的大标题读的是同一份（F-N-3）。

import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { SystemPulse } from '@/components/admin/chrome/SystemPulse';
import { NAV_GROUPS, type AdminSlug, type NavGroup, type SectionDef } from '@/lib/admin/nav';
import { sidebarBadgeFor } from '@/lib/admin/sidebar-badge-for';
import { useAdminSession } from '@/lib/admin/use-admin-session';
import { deployView, useSystemInfo } from '@/lib/admin/use-system-info';

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
