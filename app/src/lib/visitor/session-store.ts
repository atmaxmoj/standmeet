// session-store.ts —— the global single-source state for the visitor
// session (code / visitor name / quota / BYOAI flag). Shared by every
// visitor surface (index / blog / wiki / output / page).
//
// The design aligns with docs/design/project/sm-session.js:
//   - The one persistence point is the localStorage key `standmeet-session`
//   - Cross-tab sync goes through a `storage` event; same-tab, cross-component
//     goes through a custom event
//   - used is not an independent counter: it's derived from how many turns
//     this conversation has answered (useChat counts from dialogs and calls
//     setUsed). conversation is the single source, so there's no race of
//     "an optimistic increment gets overwritten by a late snapshot". max /
//     quota / name are also all reconciled from the backend.
//   - When the URL carries ?code=, this is written by the use-absorb-code
//     side after it issues a session; without ?code= it keeps using the
//     stored value
//
// Note: this store plays a different role from `standmeet:visitor-session`
// (use-gate.ts):
//   - use-gate's visitor-session stores session_token + conversation_id +
//     the byoai boolean (the "chat auth" credential)
//   - standmeet-session here stores UI display data (code / visitor /
//     quota / label / byoaiProvider — the "render source for the session
//     strip")
//   - Both get filled by the issueCodeSession response at the same time,
//     then read and written independently after that

import { create } from 'zustand';
import { z } from 'zod';

import { safeJsonString } from '@/lib/api/typed-json';

const STORAGE_KEY = 'standmeet-session';
const CHANGED_EVENT = 'sm-session-changed';

const VisitorSessionSchema = z.object({
  code: z.string().nullable(),
  visitor: z.string().nullable(),
  byoai: z.boolean(),
  byoaiProvider: z.string(),
  label: z.string().nullable(),
  used: z.number(),
  max: z.number(),
  startedAt: z.number(),
  // For the member-limit display: maxMembers is how many names this code
  // allows in total (0 = unlimited), memberCount is how many already exist.
  // Required — every session response carries quota.max_members + members,
  // stored as-is.
  maxMembers: z.number(),
  memberCount: z.number(),
  // #122: email is the visitor email typed on entry (may be empty); it
  // decides whether the booking card's "cc me" button shows (empty → no cc,
  // relay-only). ownerCanDeliver = the owner has a working mail connector
  // configured (otherwise the whole confirmation card doesn't render). Old
  // localStorage blobs lack these two fields → fall back to the default.
  email: z.string().default(''),
  ownerCanDeliver: z.boolean().default(false),
});
export type VisitorSession = z.infer<typeof VisitorSessionSchema>;

interface SessionState {
  session: VisitorSession | null;
  setSession: (s: VisitorSession | null) => void;
  setVisitor: (name: string) => void;
  // setUsed —— syncs in the backend's authoritative member-level value
  // (load / reconcile).
  setUsed: (n: number) => void;
  // incUsed —— optimistic +1 once a turn is answered. Across multiple
  // conversations, used is member-level: any surface finishing an answer
  // bumps the same shared counter by +1; the next load is corrected by the
  // backend's member-level total.
  incUsed: () => void;
  clear: () => void;
  hydrate: () => void;
}

// useIsQuotaExhausted —— used by SessionStrip / AskInput: once turns are
// exhausted, the chat entry is disabled and explicitly prompts "request
// more". max=0 means unlimited (the owner didn't set max_turns).
export function useIsQuotaExhausted(): boolean {
  const session = useVisitorSessionStore((s) => s.session);
  if (!session) return false;
  if (session.byoai) return false;
  return session.max > 0 && session.used >= session.max;
}

// useVisitorChatAvailable —— **can this page keep being asked questions**.
//
// One source, two readers: the floating widget uses it to decide whether
// to render the pill, and the about card at the page footer uses it to
// decide which line to say. It used to be judged only by the widget
// (`mode === 'public' → null`), while the card **unconditionally** said
// "keep asking below" — so an anonymous visitor read a promise this very
// page had already falsified (UX-86). Judging it in two places means the
// next time the widget's condition changes, the card gets missed
// ([[copied-invalidation-goes-stale]]); so there's only this one criterion.
//
// public (no session) = nobody is paying for inference: the owner doesn't
// foot the bill for a passing visitor, and the visitor didn't bring a key.
export function useVisitorChatAvailable(): boolean {
  return useVisitorSessionStore((s) => s.session) !== null;
}

export const useVisitorSessionStore = create<SessionState>((set, get) => ({
  session: null,
  setSession: (s) => {
    persist(s);
    set({ session: s });
  },
  setVisitor: (name) => {
    const cur = get().session;
    if (!cur) return;
    const next: VisitorSession = { ...cur, visitor: name };
    persist(next);
    set({ session: next });
  },
  setUsed: (n) => {
    const cur = get().session;
    if (!cur || cur.used === n) return;
    const next: VisitorSession = { ...cur, used: n };
    persist(next);
    set({ session: next });
  },
  incUsed: () => {
    const cur = get().session;
    if (!cur) return;
    const next: VisitorSession = { ...cur, used: cur.used + 1 };
    persist(next);
    set({ session: next });
  },
  clear: () => {
    persist(null);
    set({ session: null });
  },
  hydrate: () => {
    set({ session: load() });
  },
}));

// peekStoredSession —— reads the persisted display session directly and
// synchronously from localStorage (bypassing zustand's hydrate timing).
// The dead-session convergence point needs the code to decide which entry
// to return to, and can't wait for the store to be populated (that has a
// race).
export function peekStoredSession(): VisitorSession | null {
  return load();
}

function load(): VisitorSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? safeJsonString(raw, VisitorSessionSchema) : null;
  } catch {
    return null;
  }
}

function persist(s: VisitorSession | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (s === null) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    }
    // Same-tab, cross-component subscription; the storage event only fires
    // cross-tab.
    window.dispatchEvent(new CustomEvent(CHANGED_EVENT, { detail: s }));
  } catch {
    // localStorage full / unavailable → silent; a failed write here must
    // not block chat.
  }
}

// useSyncVisitorSession —— attached on visitor screens; listens for
// cross-tab storage + same-tab custom events, feeding localStorage changes
// into the store. Same-tab setSession/consume/clear already go through
// set(), so this mainly handles cross-tab; for simplicity it also listens
// to the same-tab custom event as a fallback.
//
// Must be called inside a client component; mount-once, doesn't depend on
// any prop.
export function bindVisitorSessionSync(): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const hydrate = useVisitorSessionStore.getState().hydrate;
  hydrate();
  const onChange = () => hydrate();
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === STORAGE_KEY) onChange();
  };
  window.addEventListener(CHANGED_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGED_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
}
