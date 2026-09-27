// use-raw —— /admin/raw state: the inbox list + its filter tabs + dump one directly.
//
// The list is corpus.list for the raw genre, one page at a time (docs/design/paging.md). A filter
// tab is a server param: filtering the loaded rows showed "none flagged" while the flagged note
// sat on page 2. A tab's count is that same filter's server total, so the number is what the tab
// lists. submitting / submitError stay local (per-section instance, no need to be global).

import { useCallback, useState } from 'react';

import { z } from 'zod';
import { adminAPI, RawAdminViewSchema, type CreateRawInput, type RawAdminView } from '@/lib/api/admin';
import { fetchListTotal } from '@/lib/api/list-total';
import { onCorpusChanged } from '@/lib/admin/corpus-changed';
import { createPagedStore, usePaged, type PagedState } from '@/lib/state/create-paged-store';
import { createResourceStore, useResource } from '@/lib/state/create-resource-store';

// RawFilter —— tabs for the raw inbox. There used to also be an 'archived'
// tab — it was **always empty**: the backend's list query always filtered
// out archived rows, and no request ever fetched them back. A tab that can
// never return data is worse than no tab at all: the owner clicks in, sees
// it empty, and thinks "I've never archived anything" instead of "this is
// broken". Delete on raw is now a real delete; the archived state no longer exists.
export type RawFilter = 'all' | 'unprocessed' | 'promoted' | 'flagged-private';

// RAW_STATE —— each tab as corpus.list's `state` param.
const RAW_STATE: Record<RawFilter, string> = {
  'all': '', 'unprocessed': 'unprocessed', 'promoted': 'promoted', 'flagged-private': 'flagged',
};
const RAW_FILTERS: readonly RawFilter[] = ['all', 'unprocessed', 'promoted', 'flagged-private'];

export const rawPage = createPagedStore({
  name: 'raw', path: '/corpus/raw', item: RawAdminViewSchema, params: { state: '' },
});

const rawTotal = (f: RawFilter) => fetchListTotal(`/api/admin/corpus/raw?state=${RAW_STATE[f]}`);

// rawCountsStore —— each tab's server total.
const rawCountsStore = createResourceStore<Record<RawFilter, number>>({
  name: 'raw-counts',
  fetcher: async () => {
    const [all, unprocessed, promoted, flagged] = await Promise.all(
      [rawTotal('all'), rawTotal('unprocessed'), rawTotal('promoted'), rawTotal('flagged-private')],
    );
    return { all, unprocessed, promoted, 'flagged-private': flagged };
  },
});

// refreshRaw —— after a raw row was added, removed, promoted or flagged: the page and the tab
// counts both re-read. Where the row now sits is the server's to say.
export async function refreshRaw(): Promise<void> {
  await Promise.all([rawPage.getState().reload(), rawCountsStore.getState().refresh()]);
}

// patchRaw —— an edit in place: the row changes where it is (an edit on page 3 stays on page 3);
// the tab counts re-read, since the private flag may have flipped.
export async function patchRaw(row: RawAdminView): Promise<void> {
  rawPage.getState().patch(row.id, () => row);
  await rawCountsStore.getState().refresh();
}

export interface RawHook {
  page: PagedState<RawAdminView>;
  filter: RawFilter;
  setFilter: (f: RawFilter) => void;
  counts: Record<RawFilter, number> | undefined;
  submitting: boolean;
  submitError: string | null;
  addRaw: (input: CreateRawInput) => Promise<boolean>;
}

// rawLeadDisplay — what a raw card's lead line shows, and its testid. A non-empty lead wins; else a
// FOLDER node (an auto-created container with children — the vault import makes one per directory
// that has no folder-note) shows its folder name (the last path segment) instead of "(untitled)";
// else empty, and the caller renders the muted "(untitled)" fallback. Lives here (not in the card)
// so the presentation layer stays free of branching logic.
export function rawLeadDisplay(
  preview: string | undefined, path: string | null | undefined, hasChildren: boolean | undefined,
): { text: string; testid: string | undefined } {
  const lead = (preview ?? '').trim();
  if (lead !== '') return { text: lead, testid: undefined };
  const folder = hasChildren === true ? ((path ?? '').split('/').filter(Boolean).pop() ?? '') : '';
  return { text: folder, testid: 'raw-folder-name' };
}

// loadRawTreeChildren —— one lazy layer of the raw inbox tree (empty parent = roots).
export function loadRawTreeChildren(parentID: string): Promise<RawAdminView[]> {
  const qs = parentID ? `?parent=${encodeURIComponent(parentID)}` : '';
  return adminAPI.get(`/corpus/raw/tree${qs}`, z.array(RawAdminViewSchema));
}

export function useRaw(): RawHook {
  const page = usePaged(rawPage);
  const counts = useResource(rawCountsStore);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const addRaw = useCallback(
    (input: CreateRawInput) => doAddRaw(input, setSubmitting, setSubmitError),
    [],
  );
  const state = page.params.state ?? '';
  return {
    page,
    filter: RAW_FILTERS.find((f) => RAW_STATE[f] === state) ?? 'all',
    setFilter: (f) => page.setParams({ state: RAW_STATE[f] }),
    counts: counts.data,
    submitting,
    submitError,
    addRaw,
  };
}

async function doAddRaw(
  input: CreateRawInput,
  setSubmitting: (b: boolean) => void,
  setErr: (m: string | null) => void,
): Promise<boolean> {
  setSubmitting(true);
  setErr(null);
  try {
    await adminAPI.post('/corpus/raw', input, RawAdminViewSchema);
    // Not awaited: the box is done once the entry is stored. Holding it until the list re-reads
    // would clear the box after the owner already typed the next thought into it.
    void refreshRaw();
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
