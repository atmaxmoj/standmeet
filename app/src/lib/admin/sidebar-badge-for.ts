// sidebar-badge-for —— AdminSidebar presentation 层不准跑 if，business
// logic 抽到 lib/。给 SidebarItem 算 badge 数字。

import type { SidebarBadges } from '@/components/admin/AdminSidebar';

const BADGE_SLUGS = new Set(['raw', 'requests', 'listings']);

export function sidebarBadgeFor(slug: string, badges?: SidebarBadges): number | null {
  if (!badges) return null;
  if (!BADGE_SLUGS.has(slug)) return null;
  const v = badges[slug as keyof SidebarBadges];
  return v !== undefined && v > 0 ? v : null;
}
