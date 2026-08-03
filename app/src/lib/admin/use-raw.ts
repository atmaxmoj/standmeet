// use-raw —— /admin/raw 状态机：list raw entries + 直接 dump 一条。
// POST /api/admin/corpus/raw 已经接通；RawDumpBox 的 onAdd 直接走 hook。
//
// zustand 重构：rawStore 管 list；filter / submitting / submitError 留 local
// state（per-section instance，不需要全局）。

import { useCallback, useEffect, useState } from 'react';

import { z } from 'zod';
import { adminAPI, RawAdminViewSchema, type CreateRawInput, type RawAdminView } from '@/lib/api/admin';
import { bumpCorpusEpoch } from '@/lib/admin/corpus-tree-epoch';
import { createResourceStore, useResource } from '@/lib/state/create-resource-store';
import type { ResourceStatus } from '@/lib/state/status';

// RawFilter —— raw 收件箱的页签。以前还有一个 'archived' —— 它**永远是空的**:
// 后端的列表查询一直过滤掉归档行,没有任何请求会把它们取回来。一个取不到数据的页签
// 比没有更糟:owner 点进去看见空的,会以为"我没有归档过的东西",而不是"这里坏了"。
// 现在 raw 的删就是真删,归档这个状态不再存在。
export type RawFilter = 'all' | 'unprocessed' | 'promoted' | 'flagged-private';

export interface RawHook {
  status: ResourceStatus;
  rows: readonly RawAdminView[];
  error: string | null;
  filter: RawFilter;
  setFilter: (f: RawFilter) => void;
  counts: Record<RawFilter, number>;
  filteredRows: readonly RawAdminView[];
  submitting: boolean;
  submitError: string | null;
  addRaw: (input: CreateRawInput) => Promise<boolean>;
}

// loadRawTreeChildren —— one lazy layer of the raw inbox tree (empty parent = roots).
export function loadRawTreeChildren(parentID: string): Promise<RawAdminView[]> {
  const qs = parentID ? `?parent=${encodeURIComponent(parentID)}` : '';
  return adminAPI.get(`/corpus/raw/tree${qs}`, z.array(RawAdminViewSchema));
}

export const rawStore = createResourceStore<RawAdminView[]>({
  name: 'raw',
  fetcher: () => adminAPI.get('/corpus/raw', z.array(RawAdminViewSchema)),
});

export function useRaw(): RawHook {
  const r = useResource(rawStore);
  const ensureLoaded = r.ensureLoaded;
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  const [filter, setFilter] = useState<RawFilter>('all');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const rows = r.data ?? [];
  const addRaw = useCallback(
    (input: CreateRawInput) => doAddRaw(input, setSubmitting, setSubmitError),
    [],
  );
  return {
    status: r.status,
    rows,
    error: r.error,
    filter,
    setFilter,
    counts: computeCounts(rows),
    filteredRows: applyFilter(rows, filter),
    submitting,
    submitError,
    addRaw,
  };
}

export function statusOf(row: RawAdminView): RawFilter {
  return row.flagged_private ? 'flagged-private' : 'unprocessed';
}

function applyFilter(rows: readonly RawAdminView[], filter: RawFilter): readonly RawAdminView[] {
  return filter === 'all' ? rows : rows.filter((r) => statusOf(r) === filter);
}

function computeCounts(rows: readonly RawAdminView[]): Record<RawFilter, number> {
  const c: Record<RawFilter, number> = {
    all: rows.length,
    unprocessed: 0, promoted: 0, 'flagged-private': 0,
  };
  rows.forEach((r) => { c[statusOf(r)]++; });
  return c;
}

async function doAddRaw(
  input: CreateRawInput,
  setSubmitting: (b: boolean) => void,
  setErr: (m: string | null) => void,
): Promise<boolean> {
  setSubmitting(true);
  setErr(null);
  try {
    const created = await adminAPI.post('/corpus/raw', input, RawAdminViewSchema);
    rawStore.getState().mutate((prev) => [created, ...(prev ?? [])]);
    bumpCorpusEpoch(); // dump bypasses useCorpusActions — bump so the lazy tree refetches
    return true;
  } catch (e) {
    setErr(e instanceof Error ? e.message : 'dump failed');
    return false;
  } finally {
    setSubmitting(false);
  }
}
