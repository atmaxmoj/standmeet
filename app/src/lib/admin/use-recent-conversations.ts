// use-recent-conversations —— 仪表盘「recent visitors」那一格的数据层。
//
// **三种结局各有各的样子**：`undefined` 还没拉到 · `null` 拉失败 · 数组 拉到了（可能是空的）。
//
// 初值曾经是 `[]`，也就是「拉到了，一个访客都没有」—— 于是加载中那一帧就写着
// 「no conversations yet — visitors will appear here once they start chatting」（F-L-52）。
// 组件那边早就分开处理了 null 和空，而**初值把第三种情形悄悄归进了「空」**。
//
// 从组件文件搬到这里：它是取数，不是呈现（呈现层守 cyclo ≤ 3 + 禁 if，
// 分支和 effect 都不该住在那儿）。

'use client';

import { useEffect, useState } from 'react';

import { fetchRecentConversations, type DashboardRecentRow } from '@/lib/admin/dashboard-fetch';

export type RecentRows = DashboardRecentRow[] | null | undefined;

export function useRecentConversations(): { rows: RecentRows } {
  const [rows, setRows] = useState<RecentRows>(undefined);
  useEffect(() => {
    void fetchRecentConversations('/api/admin/conversations/', 5)
      .then(setRows)
      .catch(() => setRows(null));
  }, []);
  return { rows };
}
