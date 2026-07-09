// use-sidebar-badges —— AdminShell 传给 AdminSidebar 的动态 badge 计数。
// fan-out 三个轻量 fetch（raw unprocessed / requests new / listings shortlist），
// 每 60s 静默 refetch。失败 → badge 不显示（不 block sidebar）。

import { useEffect, useState } from 'react';

import { z } from 'zod';

import { safeJson } from '@/lib/api/typed-json';
import type { SidebarBadges } from '@/components/admin/AdminSidebar';

const BadgeRowSchema = z.object({ items: z.array(z.object({ status: z.string() })).optional() });

export function useSidebarBadges(): SidebarBadges {
  const [badges, setBadges] = useState<SidebarBadges>({});
  useEffect(() => {
    let cancel = false;
    const run = () => void fetchBadges().then((b) => { cancel || setBadges(b); });
    run();
    const id = setInterval(run, 60_000);
    return () => { cancel = true; clearInterval(id); };
  }, []);
  return badges;
}

async function fetchBadges(): Promise<SidebarBadges> {
  const out: SidebarBadges = {};
  const [rawRes, reqRes] = await Promise.allSettled([
    fetch('/api/admin/corpus/raw/', { credentials: 'include' }),
    fetch('/api/admin/requests/', { credentials: 'include' }),
  ]);
  if (rawRes.status === 'fulfilled' && rawRes.value.ok) {
    const rows = await safeJson(rawRes.value, BadgeRowSchema);
    out.raw = (rows.items ?? []).filter((r) => r.status === 'unprocessed').length;
  }
  if (reqRes.status === 'fulfilled' && reqRes.value.ok) {
    const rows = await safeJson(reqRes.value, BadgeRowSchema);
    out.requests = (rows.items ?? []).filter((r) => r.status === 'open').length;
  }
  return out;
}
