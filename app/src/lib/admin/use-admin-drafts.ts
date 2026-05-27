// use-admin-drafts —— /admin/drafts 的 fetch hook。
// admin session cookie 已经在 AdminShell 层校验过，这里直 fetch + parse。

import { useEffect, useState } from 'react';

export type DraftStatus = 'reviewing' | 'draft' | 'sent';

export interface AdminDraftRow {
  id: string;
  company: string;
  role: string;
  for_job: string;
  updated_at: string;
  status?: DraftStatus;
  diff_text?: string;
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

export function draftPillTone(status: DraftStatus | undefined): string {
  const map: Record<DraftStatus, string> = {
    reviewing: 'is-accent',
    draft: '',
    sent: 'is-violet',
  };
  return map[status ?? 'draft'];
}

export type DraftActionKind = 'reviewing' | 'draft' | 'sent';

export function draftActionKind(status?: DraftStatus): DraftActionKind {
  return status ?? 'draft';
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
