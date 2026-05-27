// use-admin-drafts —— /admin/drafts 的 fetch hook。
// admin session cookie 已经在 AdminShell 层校验过，这里直 fetch + parse。

import { useEffect, useState } from 'react';

import { z } from 'zod';

import { safeJson } from '@/lib/api/typed-json';

export type DraftStatus = 'reviewing' | 'draft' | 'sent';

const AdminDraftRowSchema = z.object({
  id: z.string(), company: z.string(), role: z.string(), for_job: z.string(),
  updated_at: z.string(),
  status: z.enum(['reviewing', 'draft', 'sent']).optional(),
  diff_text: z.string().optional(),
});
export type AdminDraftRow = z.infer<typeof AdminDraftRowSchema>;

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
    const rows = await safeJson(res, z.array(AdminDraftRowSchema));
    setState({ rows, loading: false, error: null });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'load drafts failed';
    setState({ rows: [], loading: false, error: msg });
  }
}
