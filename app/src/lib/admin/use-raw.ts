// use-raw —— /admin/raw 状态机：list raw entries + 直接 dump 一条。
// POST /api/admin/raw 已经接通；RawDumpBox 的 onAdd 直接走 hook。

import { useCallback, useEffect, useState } from 'react';

import { adminAPI, type CreateRawInput, type RawAdminView } from '@/lib/api/admin';

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
  submitting: boolean;
  submitError: string | null;
  addRaw: (input: CreateRawInput) => Promise<boolean>;
}

export function useRaw(): RawHook {
  const [state, setState] = useState<RawState>({ kind: 'loading' });
  const [filter, setFilter] = useState<RawFilter>('all');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void initialLoad(cancelled, setState);
    return () => { cancelled = true; };
  }, []);

  const counts = useMemoCounts(state);
  const filteredRows = useFilteredRows(state, filter);
  const setF = useCallback((f: RawFilter) => setFilter(f), []);
  const addRaw = useCallback(
    (input: CreateRawInput) => doAddRaw(input, setState, setSubmitting, setSubmitError),
    [],
  );
  return {
    state, filter, setFilter: setF, counts, filteredRows,
    submitting, submitError, addRaw,
  };
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

async function doAddRaw(
  input: CreateRawInput,
  setState: (s: RawState | ((prev: RawState) => RawState)) => void,
  setSubmitting: (b: boolean) => void,
  setErr: (m: string | null) => void,
): Promise<boolean> {
  setSubmitting(true);
  setErr(null);
  try {
    const created = await adminAPI.post<RawAdminView>('/raw', input);
    setState((prev) => prependRow(prev, created));
    return true;
  } catch (e) {
    setErr(e instanceof Error ? e.message : 'dump failed');
    return false;
  } finally {
    setSubmitting(false);
  }
}

function prependRow(prev: RawState, created: RawAdminView): RawState {
  return prev.kind === 'ready'
    ? { kind: 'ready', rows: [created, ...prev.rows] }
    : { kind: 'ready', rows: [created] };
}
