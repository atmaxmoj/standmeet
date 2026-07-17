// use-requests —— /admin/requests 状态。GET 列表 + PATCH 状态。
// 默认按 status=open 过滤；点 chip 切换"open / replied / closed / all"。
//
// zustand 重构：一次拉全部，filter 在 client 走；切 chip 不再走网络。

'use client';

import { useCallback, useEffect, useState } from 'react';

import { z } from 'zod';
import { adminAPI, AccessRequestViewSchema, type AccessRequestView } from '@/lib/api/admin';
import { createResourceStore, useResource } from '@/lib/state/create-resource-store';
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
  approve: (id: string) => Promise<ApproveOutcome>;
}

export interface ApproveOutcome {
  ok: boolean;
  code?: string;
  error?: string;
}

const ApproveResultSchema = z.object({ code: z.string(), link: z.string() });

export const requestsStore = createResourceStore<AccessRequestView[]>({
  name: 'access-requests',
  fetcher: () => adminAPI.get('/access-requests', z.array(AccessRequestViewSchema)),
});

export function useRequests(): RequestsHook {
  const r = useResource(requestsStore);
  const ensureLoaded = r.ensureLoaded;
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  const [filter, setFilter] = useState<RequestStatusFilter>('open');

  // mark 抛错（不再吞掉）：调用方用 useAction 收尾（成功 toast / 失败 report）。
  const mark = useCallback(async (id: string, status: 'replied' | 'closed'): Promise<void> => {
    const updated = await adminAPI.patch(
      `/access-requests/${id}`, { status }, AccessRequestViewSchema,
    );
    requestsStore.getState().mutate((prev) =>
      (prev ?? []).map((row) => row.id === id ? updated : row));
  }, []);

  const approve = useCallback(async (id: string): Promise<ApproveOutcome> => {
    try {
      const res = await adminAPI.post(`/access-requests/${id}/approve`, {}, ApproveResultSchema);
      requestsStore.getState().mutate((prev) =>
        (prev ?? []).map((row) => row.id === id ? { ...row, status: 'replied' as const } : row));
      return { ok: true, code: res.code };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Approve failed' };
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
    approve,
  };
}

function filterByStatus(
  rows: readonly AccessRequestView[], filter: RequestStatusFilter,
): readonly AccessRequestView[] {
  if (filter === 'all') return rows;
  return rows.filter((r) => r.status === filter);
}
