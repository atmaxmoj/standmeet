// use-admin-drafts —— /admin/drafts 的 fetch hook。
// admin session cookie 已经在 AdminShell 层校验过，这里直 fetch + parse。

import { useEffect, useState } from 'react';

export interface AdminDraftRow {
  id: string;
  company: string;
  role: string;
  for_job: string;
  updated_at: string;
}

const ENDPOINT = '/api/admin/drafts/';

interface State {
  rows: AdminDraftRow[];
  loading: boolean;
  error: string | null;
}

export function useAdminDrafts(): State {
  const [state, setState] = useState<State>({ rows: [], loading: true, error: null });
  useEffect(() => { void load(setState); }, []);
  return state;
}

async function load(setState: (s: State) => void): Promise<void> {
  try {
    const res = await fetch(ENDPOINT, { credentials: 'include' });
    if (!res.ok) throw new Error(`list drafts: ${res.status}`);
    const rows = await res.json() as AdminDraftRow[];
    setState({ rows, loading: false, error: null });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'load drafts failed';
    setState({ rows: [], loading: false, error: msg });
  }
}
