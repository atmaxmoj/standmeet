// use-raw —— /admin/raw state machine: list raw entries + dump one directly.
// POST /api/admin/corpus/raw is already wired up; RawDumpBox's onAdd goes straight through this hook.
//
// zustand refactor: rawStore manages the list; filter / submitting /
// submitError stay as local state (per-section instance, no need to be global).

import { useCallback, useEffect, useState } from 'react';

import { z } from 'zod';
import { adminAPI, RawAdminViewSchema, type CreateRawInput, type RawAdminView } from '@/lib/api/admin';
import { onCorpusChanged } from '@/lib/admin/corpus-changed';
import { createResourceStore, useResource } from '@/lib/state/create-resource-store';
import type { ResourceStatus } from '@/lib/state/status';

// RawFilter —— tabs for the raw inbox. There used to also be an 'archived'
// tab — it was **always empty**: the backend's list query always filtered
// out archived rows, and no request ever fetched them back. A tab that can
// never return data is worse than no tab at all: the owner clicks in, sees
// it empty, and thinks "I've never archived anything" instead of "this is
// broken". Delete on raw is now a real delete; the archived state no longer exists.
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
    // dump bypasses useCorpusActions, so it must call this itself — but it
    // calls **the same** function, not a fresh copy of it. The previous
    // version here copied the bumpCorpusEpoch() line from run() at the time;
    // later run() added counting invalidation, and this path never followed
    // along, so the four counts stayed frozen after a quick-dump (F-L-16).
    onCorpusChanged();
    return true;
  } catch (e) {
    setErr(e instanceof Error ? e.message : 'dump failed');
    return false;
  } finally {
    setSubmitting(false);
  }
}
