// draft-detail —— #52: fetch GET /api/admin/drafts/{id} and map the real
// resume_content (+ job context) into the DraftModel the ResumeComposer edits.
// The wire schema and the mapping live in draft-wire (one parser for every reader).

import { useEffect, useState } from 'react';

import type { DraftModel } from '@/lib/admin/draft-model';
import { DraftDetailSchema, toDraftModel } from '@/lib/admin/draft-wire';
import { safeJson } from '@/lib/api/typed-json';

interface DetailState {
  model: DraftModel | null;
  // puckData — the raw Puck state to restore, or null when the draft has none yet (derive on open).
  puckData: unknown;
  error: string | null;
}

export function useDraftDetail(id: string | null): DetailState {
  const [state, setState] = useState<DetailState>({ model: null, puckData: null, error: null });
  useEffect(() => {
    if (id === null) {
      setState({ model: null, puckData: null, error: null });
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
    const detail = await safeJson(res, DraftDetailSchema);
    setState({ model: toDraftModel(detail), puckData: detail.puck_data ?? null, error: null });
  } catch (e) {
    setState({ model: null, puckData: null, error: e instanceof Error ? e.message : 'load draft failed' });
  }
}
