// tree-open-store —— **which nodes are expanded** in the corpus tree.
//
// Why this can't live in the component: `NodeItem` used to track its own
// open/closed state with `useState`, but switching articles is a
// navigation — the whole tree, along with every `NodeItem`, remounts, and
// `useState`'s initial value re-reads `openPaths` (i.e. "only expand down
// to the current one"), collapsing every branch the reader had manually
// expanded, and re-fetching every level again. On screen this looked like
// "the tree reloads whenever you switch articles".
//
// Expanded state is **state for this browsing session**, not state
// belonging to any one component: it needs to outlive any single mount.
// So it lives in a store, the same as session, ghost, and capability
// ([[mail-state-single-zustand]] — same root cause: one piece of state,
// one home, don't store a second copy at every call site).
//
// In-memory only, never persisted to storage: it's a trace of "how far
// this browsing pass got", not a preference meant to survive across days.

import { create } from 'zustand';

interface TreeOpenState {
  // open —— the paths of expanded nodes. Uses path, not id: the SSR batch
  // of objects and the token-refetched batch are two separate batches, and
  // an id isn't guaranteed to match between them, while a path is the same
  // name for the same thing.
  readonly open: ReadonlySet<string>;
  toggle: (path: string) => void;
  // ensureOpen —— auto-expands down to the current one (used when the
  // reader enters). Already-open nodes are left alone, so it never
  // re-expands a branch the reader manually collapsed.
  ensureOpen: (paths: readonly string[]) => void;
}

export const useTreeOpenStore = create<TreeOpenState>((set) => ({
  open: new Set<string>(),
  toggle: (path) => set((s) => {
    const next = new Set(s.open);
    // Delete if present, add if not — one call is both "expand" and
    // "collapse", so the caller doesn't need to check the state first.
    next.has(path) ? next.delete(path) : next.add(path);
    return { open: next };
  }),
  ensureOpen: (paths) => set((s) => {
    const missing = paths.filter((p) => !s.open.has(p));
    // If nothing is missing, **return the original Set**: creating a new
    // Set with identical contents would re-render every subscriber for
    // nothing (same root cause as [[copied-invalidation-goes-stale]]: a
    // meaningless invalidation is still an invalidation).
    return missing.length === 0 ? s : { open: new Set([...s.open, ...missing]) };
  }),
}));
