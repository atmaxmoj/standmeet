// use-sidebar-badges —— AdminShell 传给 AdminSidebar 的动态 badge 计数。
// fan-out 三个轻量 fetch（raw unprocessed / requests new / listings shortlist），
// 每 60s 静默 refetch。失败 → badge 不显示（不 block sidebar）。

import { useEffect, useState } from 'react';

import { z } from 'zod';

import { safeJson } from '@/lib/api/typed-json';
import type { SidebarBadges } from '@/components/admin/AdminSidebar';

// The list endpoints return a BARE array of rows, not `{items:[…]}`. Parsing a
// bare array as an object throws a ZodError (invalid_type object) on every admin
// load — the old `{items}` shape was wrong. Fixed to a bare-array schema.
const BadgeRowsSchema = z.array(z.object({ status: z.string().optional() }));

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
    fetch('/api/admin/corpus/raw', { credentials: 'include' }),
    fetch('/api/admin/access-requests', { credentials: 'include' }),
  ]);
  if (rawRes.status === 'fulfilled' && rawRes.value.ok) {
    const rows = await safeJson(rawRes.value, BadgeRowsSchema);
    out.raw = rows.filter((r) => r.status === 'unprocessed').length;
  }
  if (reqRes.status === 'fulfilled' && reqRes.value.ok) {
    const rows = await safeJson(reqRes.value, BadgeRowsSchema);
    out.requests = rows.filter((r) => r.status === 'open').length;
  }
  return out;
}
