// ghosts-store.ts —— Ghost steering P4: the visitor chat input box's
// **single** ghost text (no longer a queue + cycle).
//
// Sources:
//   - `ghosts` in the POST /api/v1/sessions response → seed. Takes the
//     **first item** as the single initial ghost (the QR/landing suggested
//     question set stays on code.ghosts, but the input box only consumes
//     the first one).
//   - SSE `ghost` frame (emitted after backend policy completes,
//     code-accessor only) → setPolicy, **replacing** the current one.
//
// Consumers:
//   - AskInput / ChatRoom / FloatingChatDock render the current ghost; Tab
//     → fills the input without auto-submitting; typing → the ghost is
//     naturally covered by input.value. **Esc no longer cycles** (single
//     ghost, nothing to switch to).
//
// A non-code visitor (public / byoai) always seeds empty → ghost === null →
// nothing renders. All three modes share the same code path.
//
// source ('initial' | 'policy') distinguishes the two for backend logging:
// seed = 'initial', a policy frame = 'policy'.

import { create } from 'zustand';

export type GhostSource = 'initial' | 'policy';

export interface Ghost {
  readonly text: string;
  readonly source: GhostSource;
  // targetWaypoint —— carried by a policy ghost (which waypoint it steers
  // toward); initial has none.
  readonly targetWaypoint?: string;
}

interface GhostsState {
  ghost: Ghost | null;
  // shownIDs —— a reverse lookup table from ghost text → backend row id.
  // useGhostLogger writes an entry once POST shown returns an id; other
  // hook instances (e.g. a ChatRoom remount from a mode switch) skip the
  // POST if there's already an entry, avoiding a duplicate row; accept
  // also does a lookup.
  shownIDs: Record<string, string>;
  // seed —— when the session is first obtained, takes items[0] as the
  // single initial ghost. Calling it again resets the whole thing (new
  // session → the old ghost no longer shows).
  seed: (items: readonly string[]) => void;
  // setPolicy —— an SSE `ghost` frame arrived, swap the current ghost for
  // this policy ghost (source='policy'). A policy ghost is already
  // persisted server-side (RecordPolicy); if the frame carries a ghostId,
  // mark it shown directly — the frontend does not POST /shown for it
  // (that would create a duplicate row).
  setPolicy: (text: string, ghostId?: string, targetWaypoint?: string) => void;
  // markShown —— writes the text → row id mapping after useGhostLogger's
  // POST shown succeeds.
  markShown: (text: string, id: string) => void;
  // clear —— wipes everything on chat.reset, so an old ghost doesn't
  // contaminate the new conversation.
  clear: () => void;
  // clearGhost —— F-A-9: when a turn ends with policy staying silent, only
  // clears the current ghost (keeping shownIDs so an in-flight /shown log
  // can still be looked up), so a stale steering ghost doesn't linger in
  // the input box.
  clearGhost: () => void;
}

export const useGhostsStore = create<GhostsState>((set, get) => ({
  ghost: null,
  shownIDs: {},
  seed: (items) => set({
    ghost: items.length > 0 ? { text: items[0]!, source: 'initial' } : null,
  }),
  setPolicy: (text, ghostId, targetWaypoint) => {
    if (text === '') return;
    set({ ghost: { text, source: 'policy', targetWaypoint } });
    // Already persisted server-side; if the frame carries an id, record it
    // directly into shownIDs, so the logger skips POST /shown once present.
    if (ghostId !== undefined && ghostId !== '') {
      const cur = get().shownIDs;
      set({ shownIDs: { ...cur, [text]: ghostId } });
    }
  },
  markShown: (text, id) => {
    const cur = get().shownIDs;
    if (cur[text] === id) return;
    set({ shownIDs: { ...cur, [text]: id } });
  },
  clear: () => set({ ghost: null, shownIDs: {} }),
  clearGhost: () => set({ ghost: null }),
}));

// useCurrentGhost —— React-friendly hook; a component subscribes to the
// current one (just the text).
export function useCurrentGhost(): string | null {
  return useGhostsStore((s) => s.ghost?.text ?? null);
}

// useCurrentGhostMeta —— for the backend logging path; also exposes source
// (use-ghost-logger's POST shown needs to carry it).
export function useCurrentGhostMeta(): Ghost | null {
  return useGhostsStore((s) => s.ghost);
}
