// corpus-view.ts —— the per-genre tree ⇄ grid view mode, persisted in localStorage
// so an owner's choice sticks across navigation. Logic (storage I/O, branching) lives
// in lib, not in the presentation layer. View-only — no data/security boundary here.

'use client';

import { useEffect, useState } from 'react';

export type CorpusView = 'tree' | 'grid';

const storageKey = (genre: string) => `standmeet.corpus-view.${genre}`;

function readSaved(genre: string): CorpusView | null {
  try {
    const saved = window.localStorage.getItem(storageKey(genre));
    return saved === 'grid' || saved === 'tree' ? saved : null;
  } catch {
    return null; // storage blocked (private mode / SSR) — fall back to default
  }
}

function writeSaved(genre: string, view: CorpusView): void {
  try {
    window.localStorage.setItem(storageKey(genre), view);
  } catch {
    /* storage blocked — the in-memory state still drives this session */
  }
}

// useCorpusView —— persisted per-genre view mode; defaults to 'tree' (hierarchy is
// the honest shape of the corpus) until a saved choice loads.
export function useCorpusView(genre: string): [CorpusView, (v: CorpusView) => void] {
  const [view, setView] = useState<CorpusView>('tree');
  useEffect(() => {
    const saved = readSaved(genre);
    if (saved) setView(saved);
  }, [genre]);
  const set = (v: CorpusView) => {
    setView(v);
    writeSaved(genre, v);
  };
  return [view, set];
}
