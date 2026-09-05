// use-draft-autosave —— the composer debounce-saves every edit through PATCH /drafts/{id}. Before
// this the "saved" label was cosmetic (a timer that always said "saved" while the edits were
// thrown away). Now it reflects a real persist, and `version` bumps only on a successful save so
// the preview <iframe> reloads the actual persisted render.

import { useEffect, useRef, useState } from 'react';

import type { DraftModel } from '@/lib/admin/draft-model';
import { saveDraft } from '@/lib/admin/save-draft';

export type SaveStatus = 'saved' | 'saving' | 'error';

const SAVE_DEBOUNCE_MS = 700;

export function useDraftAutosave(model: DraftModel): { status: SaveStatus; version: number } {
  const [status, setStatus] = useState<SaveStatus>('saved');
  const [version, setVersion] = useState(0);
  // Skip the very first run: the initial model is what we just loaded from the server, so saving it
  // straight back is a redundant write (and would fire on every composer open).
  const loaded = useRef(false);
  useEffect(() => {
    if (!loaded.current) {
      loaded.current = true;
      return undefined;
    }
    setStatus('saving');
    const timer = setTimeout(() => {
      saveDraft(model)
        .then(() => { setStatus('saved'); setVersion((v) => v + 1); })
        .catch(() => { setStatus('error'); });
    }, SAVE_DEBOUNCE_MS);
    return () => { clearTimeout(timer); };
  }, [model]);
  return { status, version };
}
