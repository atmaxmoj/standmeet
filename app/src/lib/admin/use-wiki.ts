// use-wiki —— /admin/wiki 状态。GET /api/admin/wiki 返 list。

'use client';

import { useEffect, useState } from 'react';

import { adminAPI } from '@/lib/api/admin';

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
  rows: readonly WikiSummary[];
  loading: boolean;
  error: string | null;
}

export function useWiki(): WikiHook {
  const [rows, setRows] = useState<WikiSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void load(setRows, setLoading, setError, () => cancelled);
    return () => { cancelled = true; };
  }, []);

  return { rows, loading, error };
}

async function load(
  setRows: (rs: WikiSummary[]) => void,
  setLoading: (b: boolean) => void,
  setError: (m: string | null) => void,
  isCancelled: () => boolean,
): Promise<void> {
  try {
    const data = await adminAPI.get<WikiSummary[]>('/wiki');
    if (isCancelled()) return;
    setRows(data);
  } catch (e) {
    if (isCancelled()) return;
    setError(e instanceof Error ? e.message : 'load failed');
  } finally {
    if (!isCancelled()) setLoading(false);
  }
}

export function pickWikiBodyState(hook: WikiHook): WikiBodyState {
  if (hook.loading) return 'loading';
  if (hook.error !== null) return 'error';
  return hook.rows.length === 0 ? 'empty' : 'list';
}
