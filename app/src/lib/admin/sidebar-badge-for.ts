// sidebar-badge-for —— AdminSidebar presentation 层不准跑 if，business
// logic 抽到 lib/。给 SidebarItem 算 badge 数字。

import type { SidebarBadges } from '@/components/admin/AdminSidebar';

const BADGE_MAP: Record<string, keyof SidebarBadges> = {
  raw: 'raw', requests: 'requests', listings: 'listings',
};

export function sidebarBadgeFor(slug: string, badges?: SidebarBadges): number | null {
  if (!badges) return null;
  const key = BADGE_MAP[slug];
  if (!key) return null;
  const v = badges[key];
  return v !== undefined && v > 0 ? v : null;
}
