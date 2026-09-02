// use-ghost-logger —— H.13.e: the visitor browser writes ghost text shown +
// accept logs to the backend, so the admin detail page can see what was
// suggested each turn and whether it was accepted.
//
// Behavior:
//   - watch useCurrentGhostMeta() — the ghost changes (also triggered by
//     the initial seed) → POST /api/v1/sessions/{conv_id}/ghosts/shown →
//     get back a row id and store it (markShown). The policy frame (P4's
//     single steering ghost) is already persisted by backend policy and
//     the frame carries an id, so setPolicy calls markShown directly; if
//     shownIDs already has it here, skip and don't write a duplicate row.
//   - acceptCurrent() — triggered by Tab; looks up the id for the most
//     recently shown text in the store → POST .../ghosts/{sid}/accept (204)
//
// A non-code-mode visitor always has ghost = null → sends no request; the
// same code supports all three modes.
//
// Session info comes from loadStoredSession (localStorage); useChat's
// ensureSession only runs on ask, but the ghost needs to render before
// ask, so this goes through storage rather than sessionRef.
//
// Dedup goes through the store, not a component-local ref: on a mode
// switch (LongScroll → ChatRoom) the hook remounts, and any local ref
// would reset — the same ghost would get POSTed a second time. The store
// is cross-instance, so if shownIDs[text] already exists, it's skipped.

'use client';

import { useCallback, useEffect } from 'react';

import { loadStoredSession } from '@/lib/gate/use-gate';
import {
  useCurrentGhostMeta, useGhostsStore, type GhostSource,
} from '@/lib/visitor/ghosts-store';

export interface GhostLogger {
  // acceptCurrent —— called on Tab; looks up the row id for the current
  // ghost text in the store's shownIDs and calls backend accept. If the
  // shown response hasn't come back yet → noop.
  acceptCurrent: () => void;
}

export function useGhostLogger(): GhostLogger {
  const meta = useCurrentGhostMeta();

  useEffect(() => {
    if (meta === null) return;
    void recordShown(meta.text, meta.source);
  }, [meta]);

  const acceptCurrent = useCallback(() => {
    if (meta === null) return;
    const id = useGhostsStore.getState().shownIDs[meta.text];
    if (id === undefined) return;
    void recordAccept(id);
  }, [meta]);

  return { acceptCurrent };
}

async function recordShown(text: string, source: GhostSource): Promise<void> {
  // store-level dedup: if text already has an id, don't send again; even
  // when multiple instances mount (LongScroll → ChatRoom switch) and both
  // run the same code, only one row gets written.
  if (useGhostsStore.getState().shownIDs[text] !== undefined) return;
  const sess = loadStoredSession();
  if (sess === null) return;
  const res = await fetch(
    `/api/v1/sessions/${sess.conversation_id}/ghosts/shown`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sess.session_token}`,
      },
      body: JSON.stringify({ ghost_text: text, source, turn_index: 0 }),
    },
  );
  if (!res.ok) return;
  const body: unknown = await res.json();
  const id = pickShownID(body);
  if (id !== null) useGhostsStore.getState().markShown(text, id);
}

async function recordAccept(id: string): Promise<void> {
  const sess = loadStoredSession();
  if (sess === null) return;
  await fetch(
    `/api/v1/sessions/${sess.conversation_id}/ghosts/${id}/accept`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${sess.session_token}` },
    },
  );
}

function pickShownID(body: unknown): string | null {
  if (!isRecord(body)) return null;
  const v = body['id'];
  return typeof v === 'string' && v !== '' ? v : null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
