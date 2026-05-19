// use-requests —— /admin/requests 状态。GET 列表 + PATCH 状态。
// 默认按 status=open 过滤；点 chip 切换"open / replied / closed / all"。

'use client';

import { useCallback, useEffect, useState } from 'react';

import { adminAPI, type AccessRequestView } from '@/lib/api/admin';

export type RequestStatusFilter = 'all' | 'open' | 'replied' | 'closed';

export type RequestsBodyState = 'loading' | 'error' | 'empty' | 'list';

// pickBodyState —— RequestsSection 用，避免 .tsx 里 if-ladder 触发 cyclo。
export function pickBodyState(hook: { loading: boolean; error: string | null; rows: readonly unknown[] }): RequestsBodyState {
  if (hook.loading) return 'loading';
  if (hook.error !== null) return 'error';
  return hook.rows.length === 0 ? 'empty' : 'list';
}

export interface RequestsHook {
  rows: readonly AccessRequestView[];
  loading: boolean;
  error: string | null;
  filter: RequestStatusFilter;
  setFilter: (f: RequestStatusFilter) => void;
  mark: (id: string, status: 'replied' | 'closed') => Promise<void>;
}

export function useRequests(): RequestsHook {
  const [rows, setRows] = useState<AccessRequestView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<RequestStatusFilter>('open');

  const load = useCallback(async (f: RequestStatusFilter): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const q = f === 'all' ? '' : `?status=${f}`;
      const data = await adminAPI.get<AccessRequestView[]>(`/access-requests${q}`);
      setRows(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(filter); }, [filter, load]);

  const mark = useCallback(async (id: string, status: 'replied' | 'closed'): Promise<void> => {
    try {
      await adminAPI.patch<AccessRequestView>(`/access-requests/${id}`, { status });
      await load(filter);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'update failed');
    }
  }, [filter, load]);

  return { rows, loading, error, filter, setFilter, mark };
}
