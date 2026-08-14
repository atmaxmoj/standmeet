// use-admin-listings —— /admin/listings 的池子(#50)。读 Redis 1d-TTL 池子里现存
// (未 commit)的 FetchedJob，admin 只读。源走 MCP jobs.fetch_new；这里只显示。
// 池子 ephemeral：过期或 fetch 太久没跑 → 空态。
//
// **一份数据一个来源**（F-N-4）：这个池子有三个读者 —— `/admin/listings` 的列表、
// dashboard 上的 `IN POOL`、以及侧栏 `listings` 那个徽章。它们必须读同一个 store，
// 不然屏幕上会出现「表头 1148、徽章空着」这种自相矛盾。徽章那一格原先三处声明
// （`NAV_GROUPS` 的 badgeTestId、`SidebarBadges.listings`、`BADGE_MAP`）零个写者，
// 于是池子里躺着 1148 条真岗位时，侧栏一声不吭。

import { useEffect } from 'react';

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { createResourceStore, useResource } from '@/lib/state/create-resource-store';

const AdminListingRowSchema = z.object({
  cache_id: z.string(),
  title: z.string(),
  company: z.string(),
  location: z.string(),
  url: z.string(),
  source_kind: z.string(),
  published_at: z.string(),
  tags: z.array(z.string()),
});
export type AdminListingRow = z.infer<typeof AdminListingRowSchema>;

const ListingsSchema = z.array(AdminListingRowSchema);

export const listingsStore = createResourceStore<AdminListingRow[]>({
  name: 'admin-listings',
  fetcher: () => adminAPI.get('/listings/', ListingsSchema),
});

interface State {
  rows: AdminListingRow[];
  loading: boolean;
  error: string | null;
}

// useAdminListings —— 给**看这个池子的那两个面**（/admin/listings 和 dashboard）。
//
// 进这一节要 `refresh` 而不是 `ensureLoaded`：池子是 1 天 TTL 的 ephemeral 数据，
// 而写它的是 MCP（owner 在 Claude 里让它抓一批），产品这边永远不知道它什么时候变。
// 缓存住第一次的结果就等于「抓完了却看不见」—— 那正是 F-L-16 那一族（计数被冻在
// 一次 mutation 之前）。共享 store 是为了让徽章和列表**同源**，不是为了少发请求。
export function useAdminListings(): State {
  const r = useResource(listingsStore);
  // 进这一节就重拉一次（`useResource` 只在 idle 时拉，缓存住的旧池子它不会动）。
  useEffect(() => { void listingsStore.getState().refresh(); }, []);
  return listingsState(r.data, r.status, r.error);
}

// useListingsCount —— 侧栏徽章：只**读**这个 store，不自己发请求。
// 它挂在每一个 admin 页上，再拉一次等于把同一份数据拉两遍。
export function useListingsCount(): State {
  const r = useResource(listingsStore);
  return listingsState(r.data, r.status, r.error);
}

function listingsState(
  data: AdminListingRow[] | undefined, status: string, error: string | null,
): State {
  return {
    rows: data ?? [],
    loading: status === 'idle' || status === 'loading',
    error: status === 'error' ? (error ?? '') : null,
  };
}

export type ListingsBodyState = 'loading' | 'error' | 'empty' | 'list';

// pickListingsBodyState —— component 用,避免 .tsx 里 if-ladder 触发 no-if/cyclo。
export function pickListingsBodyState(
  count: number, loading: boolean, error: string | null,
): ListingsBodyState {
  if (loading) return 'loading';
  if (error !== null) return 'error';
  return count === 0 ? 'empty' : 'list';
}
