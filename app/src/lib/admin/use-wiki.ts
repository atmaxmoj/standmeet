// use-wiki —— /admin/wiki 状态。GET /api/admin/wiki 返 list。

'use client';

import { useEffect } from 'react';

import { adminAPI } from '@/lib/api/admin';
import { createResourceStore, readResource } from '@/lib/state/create-resource-store';
import type { ResourceStatus } from '@/lib/state/status';

export interface WikiSummary {
  id: string;
  title: string;
  visibility: string;
  tags: string[];
  created_at: string;
  parent_id?: string | null;
}

export type WikiBodyState = 'loading' | 'error' | 'empty' | 'list';

export interface WikiHook {
  status: ResourceStatus;
  rows: readonly WikiSummary[];
  error: string | null;
}

export const wikiStore = createResourceStore<WikiSummary[]>({
  name: 'wiki',
  fetcher: () => adminAPI.get<WikiSummary[]>('/wiki'),
});

export function useWiki(): WikiHook {
  const r = readResource(wikiStore);
  const ensureLoaded = r.ensureLoaded;
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  return { status: r.status, rows: r.data ?? [], error: r.error };
}

export function pickWikiBodyState(hook: WikiHook): WikiBodyState {
  if (hook.status === 'idle' || hook.status === 'loading') return 'loading';
  if (hook.status === 'error') return 'error';
  return hook.rows.length === 0 ? 'empty' : 'list';
}
