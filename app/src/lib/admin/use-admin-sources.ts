// use-admin-sources —— /admin/job-sources 的 fetch hook(#51)。
// admin session cookie 在 AdminShell 层校验过,这里直 fetch + parse。
// 注册源走 MCP jobs.register_source;admin 只读列表。

import { useEffect, useState } from 'react';

import { z } from 'zod';

import { safeJson } from '@/lib/api/typed-json';

const AdminSourceRowSchema = z.object({
  id: z.string(),
  kind: z.string(),
  label: z.string(),
  last_fetched_at: z.string().nullable().optional(),
  created_at: z.string(),
});
export type AdminSourceRow = z.infer<typeof AdminSourceRowSchema>;

const ENDPOINT = '/api/admin/job-sources/';

interface State {
  rows: AdminSourceRow[];
  loading: boolean;
  error: string | null;
}

export function useAdminSources(): State {
  const [state, setState] = useState<State>({ rows: [], loading: true, error: null });
  useEffect(() => { void load(setState); }, []);
  return state;
}

export type SourcesBodyState = 'loading' | 'error' | 'empty' | 'list';

// pickSourcesBodyState —— component 用,避免 .tsx 里 if-ladder 触发 no-if/cyclo。
export function pickSourcesBodyState(
  count: number, loading: boolean, error: string | null,
): SourcesBodyState {
  if (loading) return 'loading';
  if (error !== null) return 'error';
  return count === 0 ? 'empty' : 'list';
}

async function load(setState: (s: State) => void): Promise<void> {
  try {
    const res = await fetch(ENDPOINT, { credentials: 'include' });
    if (!res.ok) throw new Error(`list sources: ${res.status}`);
    const rows = await safeJson(res, z.array(AdminSourceRowSchema));
    setState({ rows, loading: false, error: null });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'load sources failed';
    setState({ rows: [], loading: false, error: msg });
  }
}
