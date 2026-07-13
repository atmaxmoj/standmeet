// corpus-tree-epoch —— a global "corpus mutated" counter. The admin lazy tree caches
// each level it fetches (never re-loading the whole corpus); after any create / edit /
// delete / promote the cache is stale, so mutations bump this epoch and the visible tree
// drops + refetches its open levels. Genre-agnostic: only one corpus genre is on screen
// at a time, and raw→wiki promote touches two genres, so one shared counter is enough.

'use client';

import { create } from 'zustand';

interface CorpusEpochStore {
  epoch: number;
  bump: () => void;
}

export const corpusEpochStore = create<CorpusEpochStore>((set) => ({
  epoch: 0,
  bump: () => set((s) => ({ epoch: s.epoch + 1 })),
}));

// bumpCorpusEpoch —— call after any corpus mutation to invalidate the lazy tree.
export function bumpCorpusEpoch(): void {
  corpusEpochStore.getState().bump();
}

export function useCorpusEpoch(): number {
  return corpusEpochStore((s) => s.epoch);
}
