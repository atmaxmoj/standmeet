// sidebar-badge-for —— the AdminSidebar presentation layer must not run
// `if`; business logic is pulled out into lib/. Computes the badge number
// for a SidebarItem.

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
