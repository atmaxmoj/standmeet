// use-raw —— /admin/raw 状态机：list raw entries（MCP push 写入的）。
// backend 暂未暴露 POST /api/admin/raw —— RawDumpBox 的 onAdd 是 no-op；
// 这里只负责 fetch + filter（all / unprocessed / promoted / archived / private）。

import { useCallback, useEffect, useState } from 'react';

import { adminAPI, type RawAdminView } from '@/lib/api/admin';

export type RawFilter = 'all' | 'unprocessed' | 'promoted' | 'archived' | 'flagged-private';

interface ReadyState {
  kind: 'ready';
  rows: RawAdminView[];
}
export type RawState =
  | { kind: 'loading' }
  | ReadyState
  | { kind: 'error'; message: string };

export interface RawHook {
  state: RawState;
  filter: RawFilter;
  setFilter: (f: RawFilter) => void;
  counts: Record<RawFilter, number>;
  filteredRows: readonly RawAdminView[];
}

export function useRaw(): RawHook {
  const [state, setState] = useState<RawState>({ kind: 'loading' });
  const [filter, setFilter] = useState<RawFilter>('all');

  useEffect(() => {
    let cancelled = false;
    void initialLoad(cancelled, setState);
    return () => { cancelled = true; };
  }, []);

  const counts = useMemoCounts(state);
  const filteredRows = useFilteredRows(state, filter);
  const setF = useCallback((f: RawFilter) => setFilter(f), []);
  return { state, filter, setFilter: setF, counts, filteredRows };
}

// useMemoCounts —— ESLint forbids useMemo in components only; this is a hook
// in lib/ but to stay simple we just recompute each render (lists are small).
function useMemoCounts(state: RawState): Record<RawFilter, number> {
  return computeCounts(state.kind === 'ready' ? state.rows : []);
}

function useFilteredRows(state: RawState, filter: RawFilter): readonly RawAdminView[] {
  const rows = state.kind === 'ready' ? state.rows : [];
  return applyFilter(rows, filter);
}

function applyFilter(rows: readonly RawAdminView[], filter: RawFilter): readonly RawAdminView[] {
  return filter === 'all' ? rows : rows.filter((r) => statusOf(r) === filter);
}

export function statusOf(row: RawAdminView): RawFilter {
  return row.flagged_private ? 'flagged-private'
    : row.archived ? 'archived'
    : 'unprocessed';
}

function computeCounts(rows: readonly RawAdminView[]): Record<RawFilter, number> {
  const c: Record<RawFilter, number> = {
    all: rows.length,
    unprocessed: 0, promoted: 0, archived: 0, 'flagged-private': 0,
  };
  rows.forEach((r) => { c[statusOf(r)]++; });
  return c;
}

async function initialLoad(
  cancelled: boolean, setState: (s: RawState) => void,
): Promise<void> {
  const next = await fetchRaw();
  cancelled || setState(next);
}

async function fetchRaw(): Promise<RawState> {
  try {
    const rows = await adminAPI.get<RawAdminView[]>('/raw');
    return { kind: 'ready', rows };
  } catch (e) {
    return { kind: 'error', message: e instanceof Error ? e.message : 'load failed' };
  }
}
