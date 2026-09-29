// draft-detail —— #52: fetch GET /api/admin/drafts/{id} and map the real
// resume_content (+ job context) into the DraftModel the ResumeComposer edits.
// The wire schema and the mapping live in draft-wire (one parser for every reader).

import { useEffect, useState } from 'react';

import type { DraftModel } from '@/lib/admin/draft-model';
import { DraftDetailSchema, toDraftModel } from '@/lib/admin/draft-wire';
import { safeJson } from '@/lib/api/typed-json';

// DraftContext —— what the composer's bar shows beside the résumé: the master the draft came from
// (id '' = none) and when it expires.
export interface DraftContext {
  basedOnId: string;
  basedOnName: string;
  expiresAt: string;
}

interface DetailState {
  model: DraftModel | null;
  context: DraftContext;
  error: string | null;
}

const NO_CONTEXT: DraftContext = { basedOnId: '', basedOnName: '', expiresAt: '' };

export function useDraftDetail(id: string | null): DetailState {
  const [state, setState] = useState<DetailState>({ model: null, context: NO_CONTEXT, error: null });
  useEffect(() => {
    if (id === null) {
      setState({ model: null, context: NO_CONTEXT, error: null });
      return;
    }
    void load(id, setState);
  }, [id]);
  return state;
}

async function load(id: string, setState: (s: DetailState) => void): Promise<void> {
  try {
    const res = await fetch(`/api/admin/drafts/${id}`, { credentials: 'include' });
    if (!res.ok) throw new Error(`draft detail: ${res.status}`);
    const d = await safeJson(res, DraftDetailSchema);
    setState({
      model: toDraftModel(d),
      context: { basedOnId: d.based_on_master_id, basedOnName: d.based_on_master_name, expiresAt: d.expires_at },
      error: null,
    });
  } catch (e) {
    setState({ model: null, context: NO_CONTEXT, error: e instanceof Error ? e.message : 'load draft failed' });
  }
}
