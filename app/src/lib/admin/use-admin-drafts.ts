// use-admin-drafts —— fetch hook for /admin/drafts.
// The admin session cookie is already validated at the AdminShell layer, so this just fetches + parses directly.

import { useCallback, useEffect, useState } from 'react';

import { z } from 'zod';

import { ResumeContentSchema } from '@/lib/admin/draft-detail';
import { safeJson } from '@/lib/api/typed-json';

export type DraftStatus = 'reviewing' | 'draft' | 'sent';

// resume_content —— this is what the card's thumbnail renders. **Required**:
// if it were optional, the day the backend stops sending it, the thumbnail
// would quietly fall back to an empty document, and the owner would still be
// looking at something that "looks like a resume" (F-E-20's lesson: the more
// real that image looks, the more dangerous it is).
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

// reload —— after a commit, this list must be refetched: that transaction
// deleted the draft, and if it's still on screen the owner will think it
// failed and click again (F-E-9).
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
