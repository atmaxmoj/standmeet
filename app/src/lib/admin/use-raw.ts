// use-raw —— /admin/raw 状态机：list raw entries + 直接 dump 一条。
// POST /api/admin/corpus/raw 已经接通；RawDumpBox 的 onAdd 直接走 hook。
//
// zustand 重构：rawStore 管 list；filter / submitting / submitError 留 local
// state（per-section instance，不需要全局）。

import { useCallback, useEffect, useState } from 'react';

import { z } from 'zod';
import { adminAPI, RawAdminViewSchema, type CreateRawInput, type RawAdminView } from '@/lib/api/admin';
import { createResourceStore, readResource } from '@/lib/state/create-resource-store';
import type { ResourceStatus } from '@/lib/state/status';

export type RawFilter = 'all' | 'unprocessed' | 'promoted' | 'archived' | 'flagged-private';

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

export const rawStore = createResourceStore<RawAdminView[]>({
  name: 'raw',
  fetcher: () => adminAPI.get('/corpus/raw', z.array(RawAdminViewSchema)),
});

export function useRaw(): RawHook {
  const r = readResource(rawStore);
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
  return row.flagged_private ? 'flagged-private'
    : row.archived ? 'archived'
    : 'unprocessed';
}

function applyFilter(rows: readonly RawAdminView[], filter: RawFilter): readonly RawAdminView[] {
  return filter === 'all' ? rows : rows.filter((r) => statusOf(r) === filter);
}

function computeCounts(rows: readonly RawAdminView[]): Record<RawFilter, number> {
  const c: Record<RawFilter, number> = {
    all: rows.length,
    unprocessed: 0, promoted: 0, archived: 0, 'flagged-private': 0,
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
    return true;
  } catch (e) {
    setErr(e instanceof Error ? e.message : 'dump failed');
    return false;
  } finally {
    setSubmitting(false);
  }
}
