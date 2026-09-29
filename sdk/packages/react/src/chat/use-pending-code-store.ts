// use-pending-code-store —— when a visitor arrives with `?code=ABC` in the
// URL, the code neither stays in the URL nor passes as a parameter
// straight downstream; it's first pulled into this in-memory store, and
// the use-absorb-code effect chain handles issuing the session + clearing it.
//
// Why a store: `?code=` in the URL is not safe (screenshots / sharing /
// referer / history can all leak the plain code), so the entry hook does
// `history.replaceState` to remove it from the URL right away — but
// issuing a session at that point is async, and something needs to hold
// the code for the downstream effect to pick up. localStorage doesn't fit
// (no need for persistence, and a refresh would reuse a stale pending
// code); plain useState doesn't work either (can't pass between hooks). A
// zustand store is the smallest form of "page-level temporary state",
// consistent with the convention that client-side state goes through a
// store, not the URL.

import { create } from 'zustand';

interface PendingCodeState {
  code: string | null;
  setCode: (code: string) => void;
  consume: () => string | null;
}

export const usePendingCodeStore = create<PendingCodeState>((set, get) => ({
  code: null,
  setCode: (code) => set({ code }),
  consume: () => {
    const cur = get().code;
    if (cur !== null) set({ code: null });
    return cur;
  },
}));
