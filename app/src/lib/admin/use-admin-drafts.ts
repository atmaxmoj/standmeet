// use-admin-drafts —— /admin/drafts 的 fetch hook。
// admin session cookie 已经在 AdminShell 层校验过，这里直 fetch + parse。

import { useCallback, useEffect, useState } from 'react';

import { z } from 'zod';

import { ResumeContentSchema } from '@/lib/admin/draft-detail';
import { safeJson } from '@/lib/api/typed-json';

export type DraftStatus = 'reviewing' | 'draft' | 'sent';

// resume_content —— 卡片上那张缩略图画的就是它。**必填**：可选的话，后端哪天不再发它，
// 缩略图会安静地退回一份空文档，而 owner 看到的仍然是一张"像简历的图"（F-E-20 的教训是
// 那张图**看起来越真越危险**）。
const AdminDraftRowSchema = z.object({
  id: z.string(), company: z.string(), role: z.string(), for_job: z.string(),
  updated_at: z.string(),
  resume_content: ResumeContentSchema,
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

// reload —— commit 之后这一列必须重新拉：那一笔事务把草稿删掉了，而屏幕上还留着它，
// owner 会以为没成功、再点一次（F-E-9）。
export function useAdminDrafts(): State & { reload: () => void } {
  const [state, setState] = useState<State>({ rows: [], loading: true, error: null });
  const reload = useCallback(() => { void load(setState); }, []);
  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload };
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
