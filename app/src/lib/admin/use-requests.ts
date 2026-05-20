// use-requests —— /admin/requests 状态。GET 列表 + PATCH 状态。
// 默认按 status=open 过滤；点 chip 切换"open / replied / closed / all"。
//
// zustand 重构：一次拉全部，filter 在 client 走；切 chip 不再走网络。

'use client';

import { useCallback, useEffect, useState } from 'react';

import { adminAPI, type AccessRequestView } from '@/lib/api/admin';
import { createResourceStore, readResource } from '@/lib/state/create-resource-store';
import type { ResourceStatus } from '@/lib/state/status';

export type RequestStatusFilter = 'all' | 'open' | 'replied' | 'closed';

export type RequestsBodyState = 'loading' | 'error' | 'empty' | 'list';

// pickBodyState —— RequestsSection 用，避免 .tsx 里 if-ladder 触发 cyclo。
export function pickBodyState(
  hook: { status: ResourceStatus; error: string | null; rows: readonly unknown[] },
): RequestsBodyState {
  if (hook.status === 'idle' || hook.status === 'loading') return 'loading';
  if (hook.status === 'error') return 'error';
  return hook.rows.length === 0 ? 'empty' : 'list';
}

export interface RequestsHook {
  status: ResourceStatus;
  rows: readonly AccessRequestView[];
  error: string | null;
  filter: RequestStatusFilter;
  setFilter: (f: RequestStatusFilter) => void;
  mark: (id: string, status: 'replied' | 'closed') => Promise<void>;
}

export const requestsStore = createResourceStore<AccessRequestView[]>({
  name: 'access-requests',
  fetcher: () => adminAPI.get<AccessRequestView[]>('/access-requests'),
});

export function useRequests(): RequestsHook {
  const r = readResource(requestsStore);
  const ensureLoaded = r.ensureLoaded;
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  const [filter, setFilter] = useState<RequestStatusFilter>('open');

  const mark = useCallback(async (id: string, status: 'replied' | 'closed'): Promise<void> => {
    try {
      const updated = await adminAPI.patch<AccessRequestView>(
        `/access-requests/${id}`, { status },
      );
      requestsStore.getState().mutate((prev) =>
        (prev ?? []).map((row) => row.id === id ? updated : row));
    } catch {
      // error 走 store 的 error；UI 兜不到这里时再说
    }
  }, []);

  const all = r.data ?? [];
  return {
    status: r.status,
    rows: filterByStatus(all, filter),
    error: r.error,
    filter,
    setFilter,
    mark,
  };
}

function filterByStatus(
  rows: readonly AccessRequestView[], filter: RequestStatusFilter,
): readonly AccessRequestView[] {
  if (filter === 'all') return rows;
  return rows.filter((r) => r.status === filter);
}
