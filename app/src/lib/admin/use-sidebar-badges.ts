// use-sidebar-badges —— AdminShell 传给 AdminSidebar 的动态 badge 计数。
//
// **raw 那个数不在这里拉。** 它跟 /admin/raw 的标题、四个 tab、pulse 栏说的是同一件事,
// 所以读同一个 growth store —— 一份数据一个来源。以前它在这里自己 fetch,还挂在一个 60s 的
// 轮询上:owner 删掉一条,列表少一行,而这个 badge 最长要一分钟才认账,期间屏幕上两个数字
// 互相矛盾(F-L-16)。requests 还是自己拉(它没有共享 store)。

import { useEffect, useState } from 'react';

import { z } from 'zod';

import { pendingRequests } from '@/lib/admin/access-request-status';
import { safeJson } from '@/lib/api/typed-json';
import { useCorpusGrowth } from '@/lib/admin/use-corpus-growth';
import type { SidebarBadges } from '@/components/admin/AdminSidebar';

// The list endpoints return a BARE array of rows, not `{items:[…]}`. Parsing a
// bare array as an object throws a ZodError (invalid_type object) on every admin
// load — the old `{items}` shape was wrong. Fixed to a bare-array schema.
const BadgeRowsSchema = z.array(z.object({ status: z.string().optional() }));

export function useSidebarBadges(): SidebarBadges {
  const [badges, setBadges] = useState<SidebarBadges>({});
  // raw 走共享的 growth store(F-L-4 定下的:必须是真 COUNT(*),不是第一页的行数),
  // 于是任何一次语料 mutation 之后它跟标题、tab、pulse 栏一起动。
  const { growth } = useCorpusGrowth();
  useEffect(() => {
    let cancel = false;
    const run = () => void fetchRequestBadge().then((b) => { cancel || setBadges(b); });
    run();
    const id = setInterval(run, 60_000);
    return () => { cancel = true; clearInterval(id); };
  }, []);
  return { ...badges, raw: growth?.by_tier.raw_unprocessed };
}

async function fetchRequestBadge(): Promise<SidebarBadges> {
  const out: SidebarBadges = {};
  const res = await fetch('/api/admin/access-requests', { credentials: 'include' })
    .catch(() => null);
  if (res !== null && res.ok) {
    const rows = await safeJson(res, BadgeRowsSchema);
    out.requests = pendingRequests(rows).length;
  }
  return out;
}
